FROM node:4.4.2-slim

ENV DOCKER_BUCKET get.docker.com
ENV DOCKER_VERSION 1.9.1
ENV DOCKER_SHA256 52286a92999f003e1129422e78be3e1049f963be1888afc3c9a99d5a9af04666

RUN curl -fSL "https://${DOCKER_BUCKET}/builds/Linux/x86_64/docker-$DOCKER_VERSION" -o /usr/local/bin/docker \
	&& echo "${DOCKER_SHA256}  /usr/local/bin/docker" | sha256sum -c - \
	&& chmod +x /usr/local/bin/docker

ADD . /rekcod

ENTRYPOINT ["node", "/rekcod/cli.js"]

VOLUME ["/var/run/docker.sock"]
