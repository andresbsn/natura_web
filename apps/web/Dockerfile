FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
RUN npm install

COPY tsconfig.base.json ./
COPY apps/web ./apps/web

EXPOSE 5173

CMD ["npm", "run", "dev", "-w", "apps/web", "--", "--host", "0.0.0.0"]
