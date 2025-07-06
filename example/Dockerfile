FROM node:22.3.0-alpine

ENV TZ=Asia/Bangkok
RUN rm -rf /var/cache/apk/*
RUN mkdir -p /usr/app

RUN apk add --no-cache curl bash ca-certificates

RUN curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" && \
    install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl && \
    rm kubectl

RUN apk add --no-cache docker-cli

WORKDIR /usr/app

COPY . .

RUN npm install
RUN npm run build
RUN rm -rf node_modules
RUN npm install --production

CMD ["npm", "start"]
