FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# No runtime dependencies: only Node's standard library and global fetch.
COPY package.json ./
COPY src ./src
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "src/server.js"]
