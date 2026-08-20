FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
RUN npm install

COPY tsconfig.base.json ./
COPY apps/api ./apps/api
RUN npm run prisma:generate -w apps/api

EXPOSE 3000

CMD ["npm", "run", "dev", "-w", "apps/api"]
