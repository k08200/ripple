# Ripple 두뇌(백엔드) 컨테이너. 빌드는 repo 루트에서:
#   docker build -f backend/Dockerfile -t ripple-brain .
#   docker run -p 7077:7077 -e RIPPLE_SECRET=changeme \
#     -v ripple-data:/app ripple-brain     # -v: 히스토리 영속
FROM node:24-alpine AS build
WORKDIR /app/backend
COPY backend/package.json ./
RUN npm install
COPY backend/ ./
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY backend/package.json ./backend/
RUN cd backend && npm install --omit=dev
COPY --from=build /app/backend/dist ./backend/dist
ENV PORT=7077
ENV RIPPLE_HISTORY=/app/.ripple-history.json
EXPOSE 7077
# 기본 graph 엔진(키 불필요). LLM 모드는 -e RIPPLE_PROVIDER=hybrid -e OPENROUTER_API_KEY=...
CMD ["node", "backend/dist/server.js"]
