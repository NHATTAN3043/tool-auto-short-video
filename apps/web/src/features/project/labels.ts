import type { AutomationMode, AutomationSettings } from "@studio/domain";

export interface Label {
  title: string;
  description: string;
}

export const MODE_LABELS: Record<AutomationMode, Label> = {
  manual: {
    title: "Thủ công",
    description: "Bạn tự đưa script, giọng đọc và media. Không cần API key, không tốn phí.",
  },
  assisted: {
    title: "Hỗ trợ AI",
    description: "AI làm từng phần bạn bật: chia cảnh, gợi ý hình, giọng đọc, tìm media.",
  },
  full_ai: {
    title: "Tự động hoàn toàn",
    description: "Từ ý tưởng ra video hoàn chỉnh, bạn chỉ cần duyệt và sửa lại.",
  },
};

/** What a mode needs from the server; shown under each mode card when creating a project. */
export const MODE_REQUIREMENTS: Record<AutomationMode, string> = {
  manual: "Không cần API key",
  assisted: "Cần khoá AI trên máy chủ",
  full_ai: "Cần khoá AI trên máy chủ",
};

export const SETTING_LABELS: Record<keyof AutomationSettings, Label> = {
  scriptGeneration: { title: "Viết script bằng AI", description: "Từ ý tưởng, AI viết lời cho cả video." },
  scenePlanning: { title: "AI chia cảnh", description: "Tách script thành các cảnh hợp lý." },
  visualKeywords: { title: "Gợi ý từ khoá hình ảnh", description: "Mỗi cảnh có từ khoá để tìm media." },
  voiceGeneration: { title: "Tạo giọng đọc (TTS)", description: "Sinh giọng đọc riêng cho từng cảnh." },
  mediaSearch: { title: "Tìm media", description: "Tìm video, ảnh trong thư viện, Pexels, Pixabay." },
  mediaRanking: { title: "AI xếp hạng media", description: "Sắp xếp kết quả tìm kiếm theo độ phù hợp." },
  autoMediaSelection: {
    title: "Tự động chọn media",
    description: "Gán media tốt nhất vào cảnh, bạn duyệt sau.",
  },
};
