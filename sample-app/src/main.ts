import { items, subtotal, format } from "./checkout";

// 화면을 그린다. checkout.ts 의 값/로직을 바꾸고 저장하면 여기까지 라이브 반영(HMR).
function render(): string {
  const rows = items
    .map(
      (it) =>
        `<div class="row"><span class="label">${it.label}</span><span>${format(it.price)}</span></div>`,
    )
    .join("");
  const total = subtotal(items);

  return `
    <div class="card">
      <h1>주문 확인</h1>
      <div class="sub">결제 전 내용을 확인하세요</div>
      ${rows}
      <div class="total"><span>합계</span><span>${format(total)}</span></div>
      <button id="pay">${format(total)} 결제하기</button>
      <div class="note">🌊 이 화면은 코드 저장 시 라이브로 갱신됩니다</div>
    </div>`;
}

const app = document.getElementById("app");
if (app) {
  app.innerHTML = render();
  app.querySelector<HTMLButtonElement>("#pay")?.addEventListener("click", () => {
    alert(`결제 요청: ${format(subtotal(items))}`);
  });
}
