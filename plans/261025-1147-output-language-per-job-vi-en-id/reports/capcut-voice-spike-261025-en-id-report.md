# Spike giọng CapCut EN/ID — 2026-10-25

Nguồn ứng viên: `capcut_tts_api/Voice.json` của https://github.com/K07VN/capcut-tts-api (repo nguồn của provider CapCut; 40 giọng `en`, 5 giọng `id`, captured 2026-04).
Cách thử: `capcutProvider.synth()` thật, voice ngoài catalog → `CAPCUT_RESOURCE_ID` env; SSML/device profile GIỮ NGUYÊN (`xml:lang="en-US"`, `lan:'vi-VN'`).
Câu thử ~85 ký tự (EN / ID cùng nội dung).

| lang | voice_type | resource_id | Nhãn | Kết quả | Thời lượng |
|---|---|---|---|---|---|
| en | BV029_streaming | 6898240012404396546 | American Female | PASS | 5.95s |
| en | BV503_streaming | 7081168775646548482 | Energetic Female | PASS | 5.52s |
| en | en_us_007 | 7114563482472681986 | Male Profess | PASS | 4.78s |
| en | en_us_010 | 7114563482359435778 | Charming Male | PASS | 4.94s |
| en | ICL_en_male_philosopher_dsp | 7525722920161725712 | Narrator | PASS | 6.20s |
| en | en_female_soothing_mars_bigtts | 7526754143369760016 | Female Teacher | PASS | 5.40s |
| en | en-US-JennyMultilingualNeural | 7569439521352338689 | Jenny | FAIL `TTSInvalidSpeaker 40402004` | — |
| id | id_female_icha_uranus_bigtts | 7587328219989249296 | Icha | PASS | 5.98s |
| id | id_male_putra_uranus_bigtts | 7587328479071309073 | Putra | PASS | 7.18s |
| id | ICL_id_male_deep_god_dsp | 7605123605034208513 | Deep God | PASS | 7.09s |

Bổ sung theo user (giọng mặc định tiếng Indonesia = "Shinta"): KHÔNG có trong Voice.json của
repo nguồn, không có trong cache CapCut desktop. Lấy được từ draft project CapCut sau khi user
tạo TTS bằng Shinta: `~/Movies/CapCut/User Data/Projects/com.lveditor.draft/<project>/draft_info.json`
→ `materials.audios[]` có `tone_type`/`tone_speaker`/`resource_id` (JSON thường, đọc được).

| id | id_female_noor | 7242142046587195906 | Shinta | PASS (mặc định id, đầu catalog) | 7.01s |

Kết luận:
- 6 giọng EN + 3 giọng ID vào catalog. Jenny (Azure neural) bị CapCut từ chối → loại.
- SSML `xml:lang` + device `lan` KHÔNG cần map theo ngôn ngữ — giọng quyết định (mọi giọng EN/ID pass với cấu hình vi hiện tại).
- Tốc độ ~14-17 ký tự/s → `estimateSeconds` 15 ký tự/s dùng được cho en/id.

Chưa xác minh: đúng giọng/ngôn ngữ BẰNG TAI (máy không có ASR). Tên voice_type mang tiền tố `en_`/`id_`/BV-English, thời lượng khớp đọc bản ngữ. Mẫu mp3 ở scratchpad session (`spike/*.mp3`) — nghiệm thu nghe ở Phase 7.
