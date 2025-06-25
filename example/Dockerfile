FROM node:22.3.0-alpine

ENV TZ=Asia/Bangkok
RUN rm -rf /var/cache/apk/*
RUN mkdir -p /usr/app

RUN apk add --no-cache docker-cli

WORKDIR /usr/app

COPY . .

RUN npm install
RUN npm run build
RUN rm -rf node_modules
RUN npm install --production

CMD ["npm","start"]
