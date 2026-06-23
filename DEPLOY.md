# Ripple 배포

두 조각을 배포한다: **① 백엔드 두뇌**(팀이 닿는 호스트) + **② VS Code 익스텐션**(각 개발자).

## 어떤 시나리오든 (a/b/c) "그냥 설치하면 됨"

두뇌는 접속자를 **팀 room 으로 격리**한다 — room 은 **git 원격 주소에서 자동 도출**(같은 repo clone = 같은 팀, 설정 0). 그래서 **공용 두뇌 하나에 여러 팀이 붙어도 서로 안 보인다.** 덕분에:

| 시나리오 | 세팅 |
|---|---|
| **솔로/체험** | 익스텐션 설치 = 끝. 로컬 두뇌 자동기동(배포 0) |
| **a. 같은 사무실/LAN** | 한 명이 `npx ripple-brain` → 나머지는 `ripple.backendUrl`을 그 LAN IP로 |
| **b. 원격(각자 집)** | 두뇌 1대를 닿는 호스트(클라우드)에 → 다들 그 주소로 |
| **c. 진짜 zero-config** | **공용 두뇌 1대를 호스팅 + 그 wss URL 을 익스텐션 기본값으로 baking** → 팀원은 *설치만*. team 은 git 에서 자동 격리 |

> **c 만드는 법**: 두뇌를 닿는 호스트에 한 번 띄우고(아래 ①), `extension/package.json` 의
> `ripple.backendUrl` 기본값을 그 `wss://...` 로 바꿔서 .vsix/Marketplace 로 배포한다.
> 그러면 팀원은 익스텐션만 깔면 자동으로 그 두뇌에 붙고, **같은 repo 면 자동으로 같은 팀**(다른 팀과 격리).
> (우리가 그 호스트를 운영하면 "SaaS", 팀이 직접 띄우면 "self-host" — 코드는 동일.)

---

## ① 백엔드 두뇌 — 팀이 닿는 곳에 띄우기

두뇌는 WebSocket 서버다. 팀원들이 붙을 수 있는 호스트(사내 서버·클라우드 VM)에 띄운다.

### Docker (권장)

```bash
# repo 루트에서
docker build -f backend/Dockerfile -t ripple-brain .
docker run -d --name ripple-brain -p 7077:7077 \
  -e RIPPLE_SECRET=어떤_공유_토큰 \
  -v ripple-data:/app \
  ripple-brain
# 확인
curl http://<host>:7077/health   # {"ok":true,"provider":"graph",...}
```

- `RIPPLE_SECRET`: 설정하면 토큰 인증 강제(권장). 익스텐션의 `ripple.secret`과 일치시켜야 함.
- `-v ripple-data:/app`: 히스토리 영속(`.ripple-history.json`) → 재시작해도 백필 유지.
- LLM 모드: `-e RIPPLE_PROVIDER=hybrid -e OPENROUTER_API_KEY=...` (기본 graph는 코드 외부 전송 0).

### npm 으로 (제일 간단 — 설치 없이 실행)

두뇌는 npm 패키지(`ripple-brain`)로도 배포된다. 게시 후 누구나:

```bash
RIPPLE_SECRET=토큰 PORT=7077 npx ripple-brain      # 설치 없이 바로 실행
# 또는: npm i -g ripple-brain && ripple-brain
```

게시(메인테이너):
```bash
cd backend && npm publish        # 이름 충돌 시 @your-scope/ripple-brain 로 스코프
```

> ⚠️ **익스텐션은 npm 으로 배포 못 한다** — VS Code 확장은 Marketplace/Open VSX/.vsix 만. (아래 ②)

### Docker 없이 (소스에서)

```bash
npm install && npm run build
RIPPLE_SECRET=어떤_토큰 PORT=7077 node backend/dist/server.js
```

### TLS(wss://) 가 필요하면

서버는 평문 `ws`다. 사내망이 아니면 리버스 프록시(Caddy/nginx) 뒤에 두고 `wss://`로 종단한다.
예) Caddy: `your.domain { reverse_proxy localhost:7077 }` → 익스텐션은 `wss://your.domain`.

---

## ② VS Code 익스텐션 — 개발자에게 배포

3가지 경로. 팀 내부면 **A(.vsix 직접)**가 제일 빠르다.

### A. .vsix 직접 배포 (사내/팀 — 즉시)

```bash
npm run package            # extension/ripple.vsix 생성
```
각자: VS Code → Extensions → ··· → **Install from VSIX** → `ripple.vsix`
또는 CLI: `code --install-extension extension/ripple.vsix`
(Cursor·Windsurf 동일)

### B. VS Code Marketplace (공개)

1. **publisher 만들기**: https://marketplace.visualstudio.com/manage → 새 publisher.
2. `extension/package.json`의 `"publisher"`를 네 publisher ID로 바꾼다(현재 `ripple`은 자리표시자).
3. Azure DevOps에서 **PAT**(Personal Access Token, Marketplace: Manage 권한) 발급.
4. 게시:
   ```bash
   cd extension
   npx --yes @vscode/vsce login <publisher>
   npx --yes @vscode/vsce publish        # 또는 publish minor/patch 로 버전 bump
   ```

### C. Open VSX (Cursor·Windsurf·VSCodium 공개)

```bash
cd extension
npx --yes ovsx publish ripple.vsix -p <openvsx-token>
```
토큰: https://open-vsx.org → 계정 → Access Tokens.

---

## 배포 후 팀 온보딩 (1줄)

각 개발자: 익스텐션 설치 → 설정에서 `ripple.backendUrl = wss://<host>` (+ `ripple.secret`).
끝. 저장하면 영향이 흐른다.

## 체크리스트

- [ ] 두뇌가 팀이 닿는 호스트에서 `/health` OK
- [ ] `RIPPLE_SECRET` 설정 + 익스텐션 `ripple.secret` 일치
- [ ] (공개 시) `package.json` publisher를 실제 ID로 교체
- [ ] 외부망이면 `wss://`(TLS) 프록시

---

## ③ 자동 릴리스 (CI)

버전 태그를 밀면 .github/workflows/release.yml 이 전부 한다:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

→ 테스트 게이트 → .vsix 패키징 → **GitHub Release 에 .vsix 첨부** → **Docker 이미지 GHCR 푸시**(`ghcr.io/k08200/ripple-brain`).
GitHub repo Secrets 에 `VSCE_PAT`(Marketplace) / `OVSX_PAT`(Open VSX) 를 넣으면 공개 게시까지 자동.
