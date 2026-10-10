import type { DurationSource, ScriptSplitStrategy } from "@studio/domain";

export const STRATEGY_LABELS: Record<ScriptSplitStrategy, { title: string; description: string }> = {
  auto: { title: "Tự động", description: "Theo đoạn nếu script có nhiều đoạn, nếu không thì theo câu." },
  paragraph: {
    title: "Theo đoạn",
    description: "Mỗi đoạn (dòng trống, dòng ---, hoặc [Cảnh n]) là một cảnh.",
  },
  sentence: { title: "Theo câu", description: "Gom các câu liên tiếp, mỗi cảnh không quá số từ tối đa." },
};

export const STRATEGY_ORDER: readonly ScriptSplitStrategy[] = ["auto", "paragraph", "sentence"];

export const DURATION_SOURCE_LABELS: Record<DurationSource, { title: string; description: string }> = {
  manual: { title: "Thủ công", description: "Thời lượng bạn nhập." },
  "scene-voice": { title: "Voice cảnh", description: "Theo độ dài file giọng đọc riêng của cảnh." },
  "project-voice": {
    title: "Chia theo voice",
    description: "Phần còn lại của voice dự án, chia theo độ dài lời.",
  },
  estimate: { title: "Ước lượng", description: "Đoán từ số từ (~2,6 từ/giây). Nhập tay nếu lệch." },
};

/** Ways to mark scene breaks, shown with an example in the script guide. */
export const SCRIPT_FORMAT_RULES: readonly { title: string; example: string }[] = [
  {
    title: "Dòng trống giữa hai đoạn",
    example: "Bạn có biết mèo ngủ 16 tiếng mỗi ngày?\n\nĐó là cách chúng giữ sức để đi săn.",
  },
  { title: "Dòng ---", example: "Mở đầu thật gây tò mò.\n---\nGiải thích ngắn gọn." },
  {
    title: "Nhãn [Cảnh n] ở đầu dòng",
    example: "[Cảnh 1] Mở đầu thật gây tò mò.\n[Cảnh 2] Giải thích ngắn gọn.",
  },
];

export const SAMPLE_SCRIPT = `[Cảnh 1] Bạn có biết loài mèo ngủ tới 16 tiếng mỗi ngày?

[Cảnh 2] Không phải vì lười. Tổ tiên của chúng là thợ săn, cần dồn sức cho những cú vồ thật nhanh.

[Cảnh 3] Vậy nên lần tới thấy mèo ngủ cả ngày, hãy để nó yên nhé!

[Cảnh 4] Theo dõi để biết thêm sự thật thú vị về thú cưng.`;
