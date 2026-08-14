# PeerLearn container image.
#
# The application has no dependencies to install and no build step, so this is a
# single stage: copy source, drop privileges, run. Node 24 is pinned because
# `node:sqlite` is flag-free there.
#
# The database lives on a mounted volume (default /data), never inside the
# image: containers are replaced on every deploy.
FROM node:24-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_FILE=/data/peerlearn.db

WORKDIR /app

# Source only. There is no `npm install` because there are no dependencies.
COPY package.json ./
COPY src ./src
COPY scripts ./scripts

# Writable location for the database volume, owned by the unprivileged user.
RUN mkdir -p /data && chown -R node:node /data /app

USER node

EXPOSE 3000

# Fails the container if the app stops serving, which is what orchestrators use
# to decide a replacement is needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
