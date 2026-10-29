FROM node:26.13.0-alpine AS hardened-malloc
RUN apk add --no-cache git build-base linux-headers
RUN git clone --depth 1 https://github.com/GrapheneOS/hardened_malloc.git /hardened_malloc
WORKDIR /hardened_malloc
RUN make CONFIG_NATIVE=false CONFIG_CXX_ALLOCATOR=false

FROM node:26.13.0-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM base AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app

COPY --from=hardened-malloc /hardened_malloc/out/libhardened_malloc.so /usr/local/lib/libhardened_malloc.so

ENV NODE_ENV=production
ENV LD_PRELOAD=/usr/local/lib/libhardened_malloc.so
ENV PORT=3000

RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001 -G nodejs

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules

RUN chown -R nestjs:nodejs /app
RUN find /bin /usr/bin /usr/local/bin -xdev \( -perm /4000 -o -perm /2000 \) -exec chmod -s {} + 2>/dev/null || true

USER nestjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
	CMD node -e "const req=require('http').get('http://localhost:3000/health',(res)=>process.exit(res.statusCode===200?0:1));req.on('error',()=>process.exit(1));req.setTimeout(2000,()=>{req.destroy();process.exit(1);});" || exit 1

CMD ["node", "dist/main"]
