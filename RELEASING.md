# Ripple 릴리스 & 업데이트 (Win + Mac)

## 크로스플랫폼 — 빌드 1개로 전부

익스텐션은 **네이티브 모듈 0, 순수 JS**(`ws`만)다. 그래서:

> **`.vsix` 파일 하나가 Windows · macOS · Linux 전부에서 동작한다.** OS별로 따로 빌드 안 한다.

번들된 두뇌(자동기동)도 VS Code의 node 런타임으로 돌아서 OS 무관.

⚠️ **Windows 첫 실행**: 두뇌가 포트(TCP 7077 + UDP 7078 발견)를 열 때 **Windows 방화벽이 "허용?"을 한 번 묻는다 → 허용**. (사내망이면 안전.) Mac 은 보통 안 묻는다.

---

## 업데이트 채널 — 2가지 (중요)

| | 자동 업데이트? | 누구한테 |
|---|---|---|
| **A. Marketplace 게시** | ✅ VS Code가 알아서 업데이트 | 계속 업데이트할 거면 **이게 정답** |
| **B. .vsix 직접 공유** | ❌ 매번 수동 재설치 | 한두 번 / 사내 비공개 |

**계속 업데이트하려면 A**. sideload한 .vsix는 VS Code가 자동 갱신을 안 해줘서, B로는 매번 새 파일을 다시 깔아야 한다.

---

## A. Marketplace 게시 — 한 번 세팅, 이후 자동

### 한 번만 (최초 1회)
1. publisher 생성: https://marketplace.visualstudio.com/manage
2. `extension/package.json` 의 `"publisher": "ripple"` → **네 publisher ID** 로 교체.
3. Azure DevOps PAT 발급(Marketplace: Manage 권한).
4. GitHub repo → Settings → Secrets → **`VSCE_PAT`** 에 그 PAT 추가.
   (Open VSX 도 쓰면 `OVSX_PAT` 도. Cursor/Windsurf 사용자용.)

### 매 업데이트 (반복)
```bash
# 1) 버전만 올리기 (extension/package.json 의 version)
#    --no-git-tag-version: npm 이 멋대로 커밋·태그 만들지 않게(아래서 직접 함). 없으면 2·3번과 충돌.
npm version --prefix extension patch --no-git-tag-version   # 0.1.0 → 0.1.1  (minor/major 도 가능)
git add extension/package.json && git commit -m "release: v0.1.1"

# 2) 태그 밀기 → CI(.github/workflows/release.yml)가 전부 자동
git tag v0.1.1 && git push origin main v0.1.1
```
태그를 밀면 CI가: **테스트 게이트 → .vsix 패키징 → GitHub Release 첨부 → (VSCE_PAT 있으면) Marketplace 게시**.
→ 팀의 VS Code가 **알아서 새 버전으로 업데이트.** 재설치 0.

> 두뇌도 같이 업데이트되게 하려면: host 가 새 버전 익스텐션의 번들 두뇌로 자동기동하거나,
> 공용 두뇌면 `git pull && npm run build && 재시작`(또는 GHCR 이미지 `:v0.1.1` pull).

---

## B. .vsix 직접 공유 (자동업데이트 없음)

```bash
npm run package        # extension/ripple.vsix (Win/Mac 공용)
```
팀에 파일 전달 → 각자 VS Code: Extensions → ··· → **Install from VSIX**.
업데이트할 때마다 새 .vsix 를 다시 전달·재설치해야 함.

---

## 버전 규칙

- `extension/package.json` 의 `version` 과 git 태그 `vX.Y.Z` 를 **일치**시킨다.
- 의미: patch=버그픽스, minor=기능추가, major=호환 깨짐.
- 백엔드를 npm(`ripple-brain`)으로도 배포하면 `backend/package.json` 도 같이 올린다.
