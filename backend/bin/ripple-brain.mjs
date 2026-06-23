#!/usr/bin/env node
// Ripple 두뇌 실행 진입점. `npx ripple-brain` 또는 전역 설치 후 `ripple-brain`.
// 환경변수: PORT(기본 7077) · RIPPLE_SECRET(토큰 인증) · RIPPLE_PROVIDER(graph|hybrid|...)
import "../dist/server.js";
