# Đổi màu reel 1642152090968617: các bước theo thứ tự

Nguồn: https://www.facebook.com/reel/1642152090968617, trang **Natalie Diy**, đăng ngày 05/11/2026.
Nội dung: biến góc tường trơn thành góc tim neon đỏ.

> Lưu ý quyền sử dụng: video này **không phải của bạn**. Bạn có thể sửa để học hoặc dùng riêng, nhưng nếu đăng lại để kiếm tiền
> thì cần xin phép tác giả. Nếu không, Facebook/YouTube có thể coi là nội dung trùng lặp hoặc vi phạm bản quyền.

## Bước 1: Tải video, ghi thông số (`01_goc/`)
- `metadata.json`: thông tin gốc từ yt-dlp (tác giả, ngày đăng, các định dạng).
- `original.mp4`: bản tốt nhất (VP9 1080x1920 cộng âm thanh AAC).
- `thong-so.txt`: VP9, 1080x1920, 24 fps, **416 frame**, yuv420p, BT.709, range tv; AAC 44,1 kHz stereo; dài 17,347 giây.

## Bước 2: Tách toàn bộ frame (`02_frames/`)
- `f_0000.png` … `f_0415.png`: đủ 416 frame, giữ nguyên thứ tự.

## Bước 3: Phân tích nội dung (`03_phan-tich/`)
- `contact.jpg`: ảnh ghép, cứ 26 frame lấy một ảnh. `frame-chinh.jpg`: các frame quan trọng.
- `frames.csv`, `cuts.json`: độ chênh và độ sáng từng frame.
  - Cắt cảnh tại frame **102, 128, 167, 210**.
  - Máy quay **đứng yên từ 210 đến 415** (đo bằng optical flow, lệch dưới 0,5 px).
  - Đèn tắt dần từ frame **247 đến 271**; neon sáng hẳn khoảng frame 274–300.
- `do-mau.txt`: màu đo được (HSV).
  - Tường: sắc 2–6°, độ đậm 0,73–0,97. Tường dưới nắng: sắc 16°, độ đậm khoảng 0,35.
  - Da: sắc 19°, độ đậm 0,40. Quần áo đen: độ sáng khoảng 0,13.
  - Ghế đôn và gối: sắc 0–6°, **trùng màu tường**, nên không tách được bằng màu mà phải dùng vùng che.
- `be-ghe-don.jpg`, `ghe-don-219-227.png`, `ghe-don-goi.png`: đo vị trí ghế đôn từng frame lúc được bê vào (219–227), và hình dáng ghế đôn, gối.

## Bước 4: Vùng che (`04_mask/`)
- `r_XXXX.png` (quần áo) và `g_XXXX.png` (vùng người, nới rộng 121 px), frame 0–240.
  - Làm bằng MediaPipe: DeepLab v3 tìm người (quét thêm các ô vuông chồng nhau), Selfie Multiclass tách quần áo, tóc, da.
  - Chỉ giữ phần **vải tối**; loại tóc và da.
- `b_XXXX.png` (đồ trang trí), tạo từ cấu hình `do-trang-tri.json`:
  - Gối: hình đa giác, frame 210–415.
  - Ghế đôn: hình khối trụ. Frame 218–227 đang được bê vào nên vị trí đo tay theo từng mốc; từ frame 228 đặt cố định.
  - Có lọc theo màu đỏ để loại bàn tay. Từ frame 240 tắt bộ lọc, vì trong bóng tối bộ lọc làm thủng lỗ trên ghế.
- `m_XXXX.png`: gộp ba kênh R/G/B. `masks.mkv`: video vùng che FFV1, không mất dữ liệu.
- `kiem-tra*/`: ảnh phủ vùng che lên frame để kiểm tra bằng mắt.

## Bước 5: Cấu hình đổi màu (`05_cau-hinh/recolor.json`)
Bảng màu do người làm đề xuất (người dùng chưa chỉ định màu):

| Đối tượng | Màu gốc | Màu mới | Cách làm |
|---|---|---|---|
| Tường, kể cả chi tiết đỏ trong tranh | đỏ 2° | xanh ngọc 175° | lọc theo màu, chỉ đổi sắc, giữ độ sáng |
| Tường dưới nắng | đỏ cam 16° | xanh ngọc 175° | mục riêng, ngưỡng độ đậm 0,24–0,34 để không ăn vào ghế lười màu kem |
| Ống neon, quầng sáng | đỏ | tím 285° | chỉ bật từ frame 266–274 (lúc đèn tắt), lấy vùng sáng V từ 0,32 trở lên |
| Ánh hắt neon nhạt trên trần, sàn | đỏ nhạt | tím 285° | độ đậm 0,04–0,6 |
| Quần áo, mũ, giày | đen | xanh navy 214° | tô lại theo độ sáng (vải đen không có sắc để đổi) |
| Ghế đôn, gối | đỏ | vàng mù tạt 43° | vùng che B |
| Da người | (giữ nguyên) | | phép thử da (sắc 9–28°, độ đậm 0,18–0,62), chỉ áp dụng trong vùng người G |

## Bước 6: Render thử (`06_thu/`)
- `thu-khong-mask*.jpg`: thử phần lọc theo màu, chưa có vùng che. Từ đây phát hiện mảng tường dưới nắng (sắc 16°) chưa đổi, nên thêm mục riêng cho nó; đồng thời thu hẹp phép thử da.
- `thu-truoc-sau.jpg`: 8 frame tiêu biểu (60, 140, 190, 226, 232, 250, 300, 414) với đầy đủ vùng che.
- Lỗi phát hiện khi phóng to, và cách đã sửa:
  1. Mặt ghế đôn frame 228–239 có mảng loang, vì mặt ghế dưới nắng trùng màu da tay. Sửa: tắt bộ lọc màu đoạn này. Trong vùng ghế đôn, chỉ bảo vệ những pixel mô hình AI nhận là da (`s_XXXX.png`, `refine_person.py`).
  2. Ống neon có vòng xanh ngọc quanh lõi trắng. Sửa: mục "tường dưới nắng" chỉ bật ban ngày (trước 10,6 giây); mục neon mở rộng dải sắc (từ 8°, dải 18–32°).
- `sua-loi*.jpg`: ảnh trước/sau khi sửa.

## Bước 7: Render toàn bộ và lưu frame mới (`07_frames-moi/`)
- `r_0000.png` … `r_0415.png`: đủ **416 frame** đã đổi màu, cùng thứ tự với `02_frames/`.
- Render bằng Three.js (shader GLSL) trên iGPU: khoảng 1 phút cho bản VP9, 43 giây cho bản H.264.

## Bước 8: Kết quả (`08_ket-qua/`)
- `doi-mau (VP9 giong goc).mp4`: **cùng định dạng file gốc**: VP9, 1080x1920, 24 fps, 416 frame, BT.709/tv, dài 17,347 giây, âm thanh chép nguyên.
- `doi-mau (H264).mp4`: H.264, cùng các thông số trên, dễ đăng và xem trên mọi máy.
- `so-sanh-truoc-sau.mp4`: video gốc và bản đổi màu đặt cạnh nhau. `so-sanh-6-canh.png`: 6 cảnh trước/sau. `kiem-tra-phong-to.jpg`: ảnh phóng to các chỗ dễ lỗi.

### Kiểm tra chất lượng
- [x] Codec, kích thước, pix_fmt, fps, **số frame (416)**, chuẩn màu, thời lượng khớp với file gốc.
- [x] Âm thanh **giống hệt từng byte** (so sánh bằng `cmp`).
- [x] Độ lệch màu sau khi nén so với frame render: 1,3/255 (VP9), 1,2/255 (H.264).
- [x] Pixel không thuộc vùng đổi màu giữ nguyên (lệch 0–2/255).
- [x] Đã xem các frame tiêu biểu ở cả ba giai đoạn (ban ngày, lúc bê ghế đôn, lúc neon).

### Hạn chế còn lại
- Người phản chiếu trong gương (khoảng frame 167–210) không có vùng che, nên quần áo trong gương vẫn đen.
- Mép khuỷu tay có thể có viền xanh rất mảnh ở vài frame.
- Trần nhà, ghế lười và thảm hơi ngả xanh ngọc. Đây là ánh tường hắt lên, đúng vật lý, giống như bản gốc ngả hồng vì tường đỏ.
- Ánh vàng của dây đèn trên cây vẫn giữ màu vàng ấm (đó là đèn thật, không phải neon).
