FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY . .
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT:-3000}/api/health || exit 1
CMD ["node","server.js"]
