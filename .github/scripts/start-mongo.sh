#!/usr/bin/env bash
# Start MongoDB 7 as a one-node replica set on 127.0.0.1:27017 and wait until it is
# primary. ShopOS needs a replica set because it uses transactions.
#
# A GitHub Actions *service* container cannot be given mongod's --replSet argument
# (services take an image, not a command), so it is started here with docker run.
set -euo pipefail

docker run -d --name mongo -p 27017:27017 mongo:7 --replSet rs0 --bind_ip_all >/dev/null

initiate="try { rs.status().ok } catch (e) { rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27017'}]}).ok }"
for _ in $(seq 1 30); do
  if docker exec mongo mongosh --quiet --eval "$initiate" >/dev/null 2>&1; then break; fi
  sleep 2
done

for _ in $(seq 1 30); do
  if [ "$(docker exec mongo mongosh --quiet --eval 'db.hello().isWritablePrimary' 2>/dev/null)" = "true" ]; then
    echo "MongoDB replica set is primary"
    exit 0
  fi
  sleep 2
done

echo "MongoDB never became primary"
docker logs mongo
exit 1
