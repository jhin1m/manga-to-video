---
phase: 2
title: "Core Lib"
status: completed
effort: "M"
---

# Phase 2: Core Lib

<!-- Updated: Validation Session 1 - adaptive description, VN dialogue, optional note; MAX_EDGE default 1568 -->

## Overview

The pure, Next-independent logic: in-memory job store (`jobs.ts`), ENV-driven vision client
(`vision.ts`), and the ingest+process pipeline (`pipeline.ts`). This is the heart of the app.

## Requirements

All CORE CONSTRAINTS: ENV-driven vision, natural sort, downscale-before-send, concurrency with
index-preserving reassembly, per-image error isolation, retry/backoff, progress callback, token logging.

## Architecture

### `lib/jobs.ts` — store (singleton on `globalThis`, survives dev HMR)

```ts
interface StoredItem { index: number; filename: string; buffer: Buffer; mime: string;
                       content: SceneContent | null; error?: string; status: ItemStatus; }
interface Job { id: string; createdAt: string; items: StoredItem[]; progress: JobProgress; }

const g = globalThis as any;
const store: Map<string, Job>   = g.__mrs_jobs   ??= new Map();
const bus:   EventEmitter        = g.__mrs_bus    ??= new EventEmitter(); bus.setMaxListeners(0);

createJob(items): Job                 // id via crypto.randomUUID(); progress {done:0,total,currentIndex:null,phase:'queued'}
getJob(id): Job | undefined
updateProgress(id, patch)             // merge + bus.emit(`p:${id}`, job.progress)
setItemResult(id, index, content)     // status done, clear error
setItemError(id, index, msg)          // status error
subscribe(id, cb): () => void         // bus.on(`p:${id}`,cb); return off
```

### `lib/vision.ts` — OpenAI-compatible, ENV-driven

```ts
readVisionConfig()   // {apiKey,baseURL,model,maxEdge,concurrency}; throw Vietnamese error if apiKey missing
client = new OpenAI({ apiKey, baseURL, maxRetries: 0 })   // we own retries
let jsonModeSupported = true                              // module flag, adaptive

describeImage(buffer, filename?): Promise<SceneContent> {
  const b64 = buffer.toString('base64')
  const messages = [{ role:'user', content:[ {type:'text', text: PROMPT}, {type:'image_url', image_url:{url:`data:${mime};base64,${b64}`}} ] }]
  const res = await withRetry(() => create(messages))     // adaptive json-mode inside
  if (res.usage) console.log(`[vision] ${filename} tokens=${res.usage.total_tokens}`)
  return parseSceneJSON(res.choices[0].message.content)
}
```

- **PROMPT** (Vietnamese): instruct model to READ the panel and return ONLY raw JSON
  `{"description": string, "dialogue": string[], "note": string}`, all values in Vietnamese, no prose/markdown.
  - `description`: **adaptive length** — brief for simple panels, richer for busy/complex ones; describe what is shown, do NOT pre-write the review.
  - `dialogue`: speech-bubble text **translated to Vietnamese** (source may be JP/KO/EN), in reading order; empty array if none.
  - `note`: **empty unless useful** — SFX/onomatopoeia, scene transitions, key background, or a low-confidence flag.
- **Adaptive json-mode**: `create()` passes `response_format:{type:'json_object'}` when `jsonModeSupported`.
  On a 400 while it's on → retry once without it and set `jsonModeSupported=false` process-wide.
- **withRetry**: on 429/5xx/network error, exponential backoff (base 500ms × 2^n + jitter, ~4 tries), else rethrow.
- **parseSceneJSON**: strip ```json fences / leading noise, `JSON.parse`, coerce → `{description:String, dialogue:string[], note:String}`; throw "Model trả về không đúng JSON" on failure.
- **classifyError(err)**: 401→"Sai API key/không có quyền"; 429→"Bị giới hạn tần suất (429)"; 5xx→"Lỗi máy chủ vision"; parse→"JSON không hợp lệ"; else `err.message`.

### `lib/pipeline.ts`

```ts
extractImages(input): {filename,buffer}[]     // input = {images:Buffer[]&names} | {zip:Buffer}
  // zip → adm-zip getEntries(); keep .jpg/.jpeg/.png/.webp/.gif (not dirs); basename only
naturalSort(a,b) = a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'})   // 1,2,…,9,10,11
downscale(buffer, maxEdge): Buffer            // sharp().rotate().resize(maxEdge,maxEdge,{fit:'inside',withoutEnlargement:true}).jpeg({quality:80}).toBuffer()

processChapter(jobId, {concurrency, maxEdge}) {
  updateProgress(jobId,{phase:'processing'})
  const limit = pLimit(concurrency)
  await Promise.all(items.map(it => limit(async () => {
    updateProgress(jobId,{currentIndex: it.index})
    try {
      const small = it.buffer      // already downscaled at ingest (see below)
      const content = await describeImage(small, it.filename)
      setItemResult(jobId, it.index, content)
    } catch (e) { setItemError(jobId, it.index, classifyError(e)) }
    updateProgress(jobId,{done: doneCount+1})
  })))
  updateProgress(jobId,{phase:'done', currentIndex:null})
}
```

- **Downscale timing**: downscale ONCE at ingest (POST handler, phase 3) and store the small JPEG as
  `StoredItem.buffer`. That one buffer feeds vision, the thumbnail route, and retry. No original kept.

## Related Code Files

- Create: `content-extractor/lib/jobs.ts`, `content-extractor/lib/vision.ts`, `content-extractor/lib/pipeline.ts`

## Implementation Steps

1. `jobs.ts`: globalThis singleton store + bus, CRUD + subscribe.
2. `vision.ts`: config, client, PROMPT, adaptive json-mode create, withRetry, parseSceneJSON, classifyError.
3. `pipeline.ts`: extractImages, naturalSort, downscale, processChapter.
4. Typecheck `npx tsc --noEmit`.

## Success Criteria

- [x] `naturalSort` orders `['1','2','10']` → `1,2,10` (not `1,10,2`) — E2E xác nhận.
- [x] `describeImage` returns `{description,dialogue[],note}` and survives ```json fences.
- [x] Adaptive json-mode falls back on 400 without throwing to the caller — mock log: call 1-3 json_mode=true bị 400 → call 4-6 json_mode=false thành công.
- [x] One failing image sets `item.error` (Vietnamese) and does NOT stop the others — E2E: 401 giữa job, 1 item lỗi, 2 item sống.
- [x] Store + bus survive dev HMR (attached to `globalThis`).
- [x] Token usage logged when `res.usage` present — log: `[vision] 1.jpg tokens=42`.

## Risk Assessment

- Any 400 disables json-mode (over-eager) → harmless; robust text parse still runs. Acceptable.
- EventEmitter listener cap → `setMaxListeners(0)`; each subscribe returns an unsub used on SSE close.
