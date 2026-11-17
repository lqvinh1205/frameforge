# frameforge

Vẽ lại video bằng **Three.js (WebGL trên iGPU)** + **ffmpeg (VAAPI)**. Hai chức năng:

- **A. Đổi màu video thật**: tường, quần áo, đồ vật... Chỉ đổi *sắc màu*, giữ nguyên độ sáng và độ đậm của từng pixel, nên bóng đổ và nếp vải vẫn tự nhiên.
- **B. Làm phim 3D từ kịch bản**: tạo nhân vật mẫu, viết kịch bản JSON, tool tự lồng giọng, khẩu hình, hành động, góc máy rồi xuất ra mp4.

## Cài đặt

```bash
cd ~/Desktop/tool/frameforge
npm install                 # three, puppeteer-core (dùng Chrome có sẵn trên máy)
```
Cần: Node ≥ 22.6 (chạy thẳng file `.ts`), ffmpeg, Google Chrome/Chromium.
Giọng đọc dùng Kokoro trong venv của render-video. Muốn dùng Python khác thì đặt `FF_PYTHON=/đường/dẫn/python`.

## Ngôn ngữ và kiến trúc

| Phần | Ngôn ngữ | Vì sao |
|---|---|---|
| Điều phối, gọi ffmpeg | **TypeScript (Node.js)** | Cùng ngôn ngữ với Three.js; Node chạy `.ts` trực tiếp, không cần build |
| Vẽ hình | **JavaScript + GLSL** (Three.js trong Chrome ẩn) | WebGL chạy trên iGPU thật (`ANGLE … radeonsi`) |
| Giọng đọc (Kokoro, Chatterbox), sau này là AI tách vùng (SAM 2) | **Python** (script phụ) | Các mô hình AI chỉ có bản Python |
| Viết kịch bản | Claude Code CLI | Dùng gói đăng ký Claude của bạn |

```
ffmpeg giải mã ─yuv420p─► Node ─HTTP─► Chrome ẩn: Three.js/GLSL trên iGPU
                                        │  (đổi YUV↔RGB, đổi màu / dựng cảnh 3D, gói lại YUV)
ffmpeg VAAPI ◄─yuv420p── Node ◄─HTTP────┘
```
Frame đi qua lại ở dạng **yuv420p** (1,5 byte/pixel thay vì 4); việc đổi ma trận màu làm trên GPU. Pixel không bị đổi màu thì ra **giống hệt từng bit** (đã đo PSNR = ∞).

## A. Đổi màu video

```bash
node ff.ts pick  video.mp4 --at 5 --point 900,1100     # đo màu tại điểm + liệt kê màu chính + ảnh lưới toạ độ
node ff.ts edit  video.mp4                             # mở trình chỉnh: click lên video để chọn màu, kéo thanh trượt
node ff.ts recolor video.mp4 -c video.recolor.json --start 3 --duration 5   # render thử 5 giây
node ff.ts recolor video.mp4 -c video.recolor.json     # render cả video → "video - doi mau.mp4"
node ff.ts sheet goc.mp4 "video - doi mau.mp4" -o so-sanh.png               # ảnh so sánh trước/sau
```

Cấu hình (`examples/recolor-butter.json`):
```json
{
  "targets": [
    { "name": "bơ vàng -> xanh bạc hà", "from": 58, "to": 150, "range": [12, 26], "sat": [0.15, 0.3], "satK": 0.9 },
    { "name": "tường đỏ (chỉ từ giây 8)", "from": 2, "to": 170, "when": [[8, 999]] }
  ],
  "skin": { "hue": [5, 28], "sat": [0.18, 0.7], "val": 0.2 },
  "mask": { "r": { "mode": "repaint", "hue": 214, "sat": 0.55 }, "g": { "mode": "person" }, "b": { "mode": "hue", "hue": 43 } }
}
```

| Trường | Ý nghĩa |
|---|---|
| `from` / `to` | Sắc gốc / sắc mới (độ, 0–360) |
| `range` | Lệch sắc dưới `[0]` thì đổi hết, trên `[1]` thì không đổi, ở giữa đổi mềm dần |
| `sat` | Bỏ qua màu nhạt (trắng/xám) |
| `val` | Bỏ qua màu gần đen |
| `satK` / `valK` | Nhân độ đậm / độ sáng (đổi sang màu "sáng mắt" hơn thì giảm `valK` khoảng 0,85) |
| `keepOffset` | Giữ độ lệch sắc tự nhiên của từng pixel (mặc định bật) |
| `protectSkin` | Không đổi pixel giống màu da (mặc định bật) |
| `when` | Chỉ đổi trong các khoảng thời gian (giây), chuyển mềm 0,25 s |
| `mask` (tuỳ chọn, `--mask mask.mp4`) | Video vùng che: kênh R/G/B có các chế độ `hue` (đổi sắc), `repaint` (tô lại vải đen theo độ sáng), `protect` (cấm đổi), `person` (chỉ bảo vệ da trong vùng này) |

Tốc độ đo trên máy này (Ryzen 5 5500U, Vega iGPU): video dọc 1080x1920 đạt **25 frame/giây**.

### Video phức tạp: vùng che (mask)
Khi vật trùng màu nền (ghế đỏ trên tường đỏ) hoặc cần đổi quần áo, dùng các script trong `src/recolor/`:

| Script | Venv | Việc |
|---|---|---|
| `analyze.py FRAMES OUT` | render-video | cắt cảnh, đoạn máy quay đứng yên, đường cong độ sáng |
| `person_masks.py FRAMES OUT --range a-b` | `~/.local/share/frameforge/seg-venv` (mediapipe) | `r_` quần áo, `g_` vùng người, `s_` da và tóc |
| `decor_masks.py objects.json FRAMES OUT` | render-video | `b_` đồ trang trí: hình đa giác/khối trụ theo mốc frame, lọc theo màu |
| `refine_person.py OUT a b` | render-video | chỉ bảo vệ da thật khi tay chạm vật cùng màu da |
| `combine_masks.py OUT FRAMES FPS --check ...` | render-video | gộp thành `m_` và `masks.mkv` (không mất dữ liệu), kèm ảnh kiểm tra |

Sau đó chạy `node ff.ts recolor video.mp4 -c cfg.json --mask OUT/masks.mkv [--codec vp9] [--frames-dir frames-moi]`.
Ví dụ đầy đủ theo từng bước: `projects/reel-1642152090968617/BUOC-LAM.md`.

## B. Làm phim 3D

```bash
node ff.ts write "Bình nhờ An trông mèo, mèo trốn mất..." --cast an,binh --seconds 25 -o kich-ban.json   # Claude viết kịch bản
node ff.ts studio                              # trình tạo nhân vật mẫu → characters/<ten>.json
node ff.ts film examples/film-banh.json --still 1,4,8   # xem trước vài khung hình (ảnh .anh.png)
node ff.ts film examples/film-banh.json        # render phim → examples/film-banh.mp4 + phụ đề .srt
```

Kịch bản (`examples/film-banh.json`):
```json
{
  "format": "9:16",
  "set": { "wall": "#f3d9b1", "floor": "#a8794f", "light": "day",
           "props": [{ "type": "sofa", "x": 0, "z": -2.4, "color": "#5b7bb5" }, { "type": "cake", "x": 0.15, "z": -1 }] },
  "cast": { "an": { "use": "an.json", "x": -0.75 }, "binh": { "use": "binh.json", "x": 0.75 } },
  "lines": [
    { "who": "binh", "say": "Okay. Who ate my cake?", "emotion": "angry", "action": "angry" },
    { "who": "an", "say": "Cake? What cake?", "action": "shrug", "react": { "binh": "think" } },
    { "who": "binh", "action": "cry", "duration": 1.4 },
    { "who": "an", "say": "Fine! Two cakes. Deal?", "action": "wave", "moveTo": 0.0, "shot": "close" }
  ]
}
```

- **format**: `9:16`, `16:9`, `1:1`, `4:5`, `720p`, `9:16-720` (hoặc tự đặt `width`/`height`); thêm `fps`.
- **set**: `wall`, `floor`, `sky`, `window`, `light` (`day`/`evening`/`night`), `props[]` gồm `type`, `x`, `z`, `rotate`, `scale`, `color`...
  Các loại đồ vật: sofa, table, desk, chair, plant, lamp, bed, shelf, rug, picture, door, tv, box, cake.
- **cast**: `use` là file nhân vật mẫu; các trường viết thêm sẽ ghi đè lên mẫu (ví dụ đổi màu áo cho riêng tập này). `x`, `z` là vị trí đứng.
- **lines**:
  - `say` (bỏ trống = câu không thoại, dùng `duration`)
  - `action`: wave, point, shrug, nod, shake, jump, laugh, angry, think, cry, clap, dance, surprised
  - `emotion`: neutral, happy, sad, angry, surprised
  - `react`: phản ứng của người nghe, ví dụ `{ "an": "laugh" }`
  - `shot`: wide, medium, close; bỏ trống thì tool tự chọn
  - `moveTo`: đi tới vị trí x
  - `pause`, `delay`: khoảng nghỉ sau/trước câu
- **music**: `{ "path": "nhac.mp3", "db": -20 }`, nhạc nền tự lặp lại và tự nhỏ dần ở cuối.
- **voiceEngine**: `kokoro` (mặc định, nhanh) hoặc `chatterbox` (truyền cảm hơn, chậm hơn); có thể đặt riêng cho từng nhân vật bằng `engine`.
- Âm thanh được chuẩn hoá về -16 LUFS. Phụ đề nằm trong thư mục `<tên> - phu de/`, nên trình phát không tự nạp chồng lên video.
  Muốn chèn phụ đề vào hình hoặc thêm logo thì đưa mp4 qua render-video.

Tốc độ: phim mẫu dài 19 giây, khổ 1080x1920, **render mất 16 giây** (giọng đọc đã có sẵn trong bộ nhớ đệm).

### Nhân vật VRM (VRoid Studio...)

1. Chép file `.vrm` vào `assets/vrm/`.
2. Mở `node ff.ts studio`, chọn **Mô hình**, đổi màu từng phần nếu muốn, rồi lưu.
   Hoặc viết thẳng trong kịch bản: `"cast": { "seed": { "model": "Seed-san.vrm", "gender": "f", "x": 0.7 } }`.

Nhân vật VRM dùng chung mọi hành động, biểu cảm, khẩu hình và góc máy với nhân vật khối. Tóc và quần áo có vật lý (spring bone).
- **Kiểm tra giấy phép tự động:** tool đọc thông tin giấy phép ghi sẵn trong file VRM. Nếu mô hình **cấm dùng thương mại** thì tool dừng lại, vì video bật kiếm tiền.
- **Ghi công:** nếu mô hình bắt buộc ghi tên tác giả, tool in ra dòng ghi công và lưu vào `<tên> - phu de/credits.txt` để bạn dán vào mô tả video.
- Mẫu có sẵn: `assets/vrm/Seed-san.vrm` của VirtualCast, Inc., theo VRM Public License 1.0, được dùng thương mại, **bắt buộc ghi công**.

### Giọng đọc

| Engine | Tốc độ trên máy này | Ghi chú |
|---|---|---|
| `kokoro` | Vài giây cho cả phim | Apache-2.0; giọng chọn bằng `voice` (am_michael, af_heart...) |
| `chatterbox` | Khoảng 10 giây mỗi câu (CPU) | MIT, truyền cảm hơn. Giọng mỗi nhân vật được nhân bản từ giọng Kokoro của nhân vật đó; muốn giọng riêng thì dùng `"voiceRef": "giong.wav"` (đoạn ghi âm trên 5 giây, của bạn hoặc có quyền dùng). `"voiceRef": ""` là giọng có sẵn của Chatterbox |

Giọng đã tạo được lưu trong `~/.cache/frameforge/tts`, render lại không phải tạo lại.
Với Chatterbox, có thể chèn tiếng cười, thở dài vào lời thoại: `[laugh]`, `[chuckle]`, `[sigh]`, `[gasp]`. Kokoro và phụ đề tự bỏ các thẻ này.

### Claude viết kịch bản

`node ff.ts write "ý tưởng" -o kich-ban.json` gọi Claude Code CLI (`claude -p`, dùng gói đăng ký của bạn).
Claude chọn nhân vật trong `characters/` (hoặc theo `--cast`), dựng phòng, viết thoại kiểu Mỹ, có câu mở đầu gây chú ý và câu chốt.
Kết quả là JSON đúng định dạng; bạn có thể sửa tay trước khi chạy `film`.

## Biến môi trường

| Biến | Tác dụng |
|---|---|
| `FF_HWENC=cpu` | Mã hoá bằng CPU (libx264) thay vì iGPU |
| `FF_GL=swiftshader` | Máy không có GPU |
| `FF_CHROME` | Đường dẫn Chrome |
| `FF_PYTHON` | Python có cài kokoro |
| `FF_CHATTERBOX_PY` | Python có cài chatterbox |
| `FF_DEBUG=1` | In log của trang, thời gian từng bước |

## Lộ trình tiếp theo

1. **SAM 2**: click một điểm là tool tự bám vật qua các frame và tạo `mask.mp4`. Cần cho vật trùng màu nền, ví dụ hoa vàng trên bơ vàng.
2. Động tác Mixamo / VRMA cho nhân vật VRM (hiện dùng động tác tự sinh).
3. Âm thanh hiệu ứng (tiếng bước chân, cửa...).
4. Thay đồ vật hoặc người trong video thật bằng mô hình video AI. Cần GPU cloud.
