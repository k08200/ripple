// 체크아웃 화면 데이터/로직. 이 파일을 저장하면 화면이 라이브로 바뀐다.
// (payment-api 변경 → 이 프론트가 영향받는 데모 서사와 연결)

export interface LineItem {
  label: string;
  price: number;
}

export const CURRENCY = "₩";

export const items: LineItem[] = [
  { label: "Ripple Pro (월)", price: 29000 },
  { label: "시트 추가 ×3", price: 27000 },
  { label: "런칭 할인", price: -10000 },
];

export function subtotal(list: LineItem[]): number {
  return list.reduce((sum, it) => sum + it.price, 0);
}

export function format(amount: number): string {
  return `${CURRENCY}${amount.toLocaleString("ko-KR")}`;
}
