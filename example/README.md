# Example how to use tspace-nfs

## Install

### Run with Nodejs
```sh
npm install

npm run dev

http://localhost:8000
http://localhost:8000/studio

```

### Run with Docker
```sh

sh deploy.sh
Do you want to build the Docker image: yes
Choose the environment to deploy: 1

http://localhost:8000
http://localhost:8000/studio

```

### Run with K8s
```sh

sh deploy.sh
Do you want to build the Docker image: yes
Choose the environment to deploy: 2

http://localhost:30080
http://localhost:30080/studio

```