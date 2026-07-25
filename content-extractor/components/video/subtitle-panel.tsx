'use client';

// Panel chỉnh style phụ đề ở stage video. Controlled hoàn toàn — không giữ state riêng, mọi
// thay đổi đẩy ngược qua onChange để trang là nguồn sự thật duy nhất của RenderConfig.
//
// Cách map sang ASS (và sang CSS của preview) nằm ở lib/subtitle-style.ts — panel này chỉ
// dựng control, không tự suy diễn gì về libass.
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { FONT_CATALOG, FONT_CATEGORY_LABEL, type FontEntry } from '@/lib/fonts';
import type { SubtitleBorder, SubtitleStyle } from '@/lib/schema';
import { SUBTITLE_PRESETS } from '@/lib/subtitle-presets';

const BORDER_OPTIONS: Array<{ value: SubtitleBorder; label: string }> = [
  { value: 'none', label: 'Không' },
  { value: 'outline', label: 'Viền' },
  { value: 'box', label: 'Nền hộp' },
];

const CATEGORY_ORDER: Array<FontEntry['category']> = ['sans', 'condensed', 'display', 'serif'];

// Hàng control nhãn-trái / điều-khiển-phải, đồng bộ với các card khác của trang.
function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="min-w-0">{label}</span>
      {children}
    </label>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent"
    />
  );
}

export function SubtitlePanel({
  value,
  onChange,
}: {
  value: SubtitleStyle;
  onChange: (style: SubtitleStyle) => void;
}) {
  const set = <K extends keyof SubtitleStyle>(key: K, v: SubtitleStyle[K]) =>
    onChange({ ...value, [key]: v });
  const isBox = value.border === 'box';
  const hasBorder = value.border !== 'none';

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">Phụ đề</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-4 text-xs text-muted-foreground">
        {/* Preset dựng sẵn — áp cả bộ, giữ nguyên lựa chọn xuất/burn của người dùng */}
        <div className="flex flex-wrap gap-1">
          {SUBTITLE_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              size="xs"
              variant="outline"
              title={preset.hint}
              onClick={() => onChange({ ...value, ...preset.style })}
            >
              {preset.label}
            </Button>
          ))}
        </div>

        <Separator />

        <Row label="Font">
          <Select value={value.font} onValueChange={(v) => set('font', v)}>
            <SelectTrigger size="sm" className="w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_ORDER.map((category) => (
                <SelectGroup key={category}>
                  <SelectLabel>{FONT_CATEGORY_LABEL[category]}</SelectLabel>
                  {FONT_CATALOG.filter((f) => f.category === category).map((font) => (
                    <SelectItem
                      key={font.family}
                      value={font.family}
                      style={{ fontFamily: `'${font.family}', sans-serif` }}
                    >
                      {font.family}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row label={`Cỡ chữ: ${value.sizePct.toFixed(1)}%`}>
          <Slider
            min={2}
            max={10}
            step={0.1}
            value={[value.sizePct]}
            onValueChange={([v]) => set('sizePct', v)}
            className="w-32"
          />
        </Row>

        <Row label="Màu chữ">
          <div className="flex items-center gap-2">
            <span className="tabular-nums">{Math.round(value.opacity * 100)}%</span>
            <Slider
              min={0.1}
              max={1}
              step={0.05}
              value={[value.opacity]}
              onValueChange={([v]) => set('opacity', v)}
              className="w-20"
            />
            <ColorInput value={value.color} onChange={(v) => set('color', v)} />
          </div>
        </Row>

        <Row label="Kiểu chữ">
          <div className="flex items-center gap-1">
            <Button
              size="xs"
              variant={value.bold ? 'default' : 'outline'}
              onClick={() => set('bold', !value.bold)}
              title="Đậm"
              className="font-bold"
            >
              B
            </Button>
            <Button
              size="xs"
              variant={value.italic ? 'default' : 'outline'}
              onClick={() => set('italic', !value.italic)}
              title="Nghiêng"
              className="italic"
            >
              I
            </Button>
            <Button
              size="xs"
              variant={value.underline ? 'default' : 'outline'}
              onClick={() => set('underline', !value.underline)}
              title="Gạch chân"
              className="underline"
            >
              U
            </Button>
            <Button
              size="xs"
              variant={value.uppercase ? 'default' : 'outline'}
              onClick={() => set('uppercase', !value.uppercase)}
              title="Viết hoa toàn bộ (áp cả .srt rời)"
            >
              AA
            </Button>
          </div>
        </Row>

        <Row label={`Giãn chữ: ${value.letterSpacing}`}>
          <Slider
            min={-1}
            max={5}
            step={0.5}
            value={[value.letterSpacing]}
            onValueChange={([v]) => set('letterSpacing', v)}
            className="w-32"
          />
        </Row>

        <Separator />

        <Row label="Viền / nền">
          <div className="flex items-center gap-1">
            {BORDER_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                size="xs"
                variant={value.border === opt.value ? 'default' : 'outline'}
                onClick={() => set('border', opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </Row>

        {hasBorder && (
          <>
            <Row label={isBox ? `Đệm hộp: ${value.outlineWidth}` : `Độ dày viền: ${value.outlineWidth}`}>
              <Slider
                min={0}
                max={4}
                step={0.5}
                value={[value.outlineWidth]}
                onValueChange={([v]) => set('outlineWidth', v)}
                className="w-32"
              />
            </Row>
            <Row label={isBox ? 'Màu nền hộp' : 'Màu viền'}>
              <div className="flex items-center gap-2">
                <span className="tabular-nums">{Math.round(value.outlineOpacity * 100)}%</span>
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  value={[value.outlineOpacity]}
                  onValueChange={([v]) => set('outlineOpacity', v)}
                  className="w-20"
                />
                <ColorInput value={value.outlineColor} onChange={(v) => set('outlineColor', v)} />
              </div>
            </Row>
          </>
        )}

        <Row label={`Đổ bóng: ${value.shadowDepth}`}>
          <div className="flex items-center gap-2">
            <Slider
              min={0}
              max={4}
              step={0.5}
              value={[value.shadowDepth]}
              onValueChange={([v]) => set('shadowDepth', v)}
              className="w-20"
            />
            <ColorInput value={value.shadowColor} onChange={(v) => set('shadowColor', v)} />
          </div>
        </Row>

        <Separator />

        <Row label="Vị trí">
          <Select
            value={value.position}
            onValueChange={(v) => set('position', v as SubtitleStyle['position'])}
          >
            <SelectTrigger size="sm" className="w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bottom">Dưới</SelectItem>
              <SelectItem value="middle">Giữa</SelectItem>
              <SelectItem value="top">Trên</SelectItem>
            </SelectContent>
          </Select>
        </Row>

        <Row label={`Lề dọc: ${value.marginPct}%`}>
          <Slider
            min={0}
            max={25}
            step={1}
            value={[value.marginPct]}
            onValueChange={([v]) => set('marginPct', v)}
            className="w-32"
          />
        </Row>

        <Row label={`Lề ngang: ${value.sideMarginPct}%`}>
          <Slider
            min={0}
            max={25}
            step={1}
            value={[value.sideMarginPct]}
            onValueChange={([v]) => set('sideMarginPct', v)}
            className="w-32"
          />
        </Row>

        <Row label={value.maxCharsPerLine === 0 ? 'Ngắt dòng: tự động' : `Ngắt dòng: ${value.maxCharsPerLine} ký tự`}>
          <Input
            type="number"
            min={0}
            max={80}
            value={value.maxCharsPerLine}
            onChange={(e) => {
              const n = Number(e.target.value);
              // < 12 ký tự/dòng là vô nghĩa — coi như tắt, đúng như migrateSubtitleStyle.
              set('maxCharsPerLine', !Number.isFinite(n) || n < 12 ? 0 : Math.min(80, Math.round(n)));
            }}
            className="h-7 w-16 px-1.5 text-xs"
          />
        </Row>

        <Separator />

        <Row label="Burn-in vào video (luôn kèm .srt rời)">
          <Switch checked={value.burnIn} onCheckedChange={(v) => set('burnIn', v)} />
        </Row>
      </CardContent>
    </Card>
  );
}
