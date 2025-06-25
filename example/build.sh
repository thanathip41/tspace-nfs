IMAGE="example-nfs-server:develop"

docker-compose down

docker rmi $IMAGE

docker build --no-cache -t $IMAGE .
