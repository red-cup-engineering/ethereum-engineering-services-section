FROM node:24-slim
WORKDIR /app/services/account-abstraction-services-section/services/erc-4337-bundler-service
COPY services/sign-ethereum-digest-with-cloud-kms-services-section /app/services/sign-ethereum-digest-with-cloud-kms-services-section
RUN npm install --prefix /app/services/sign-ethereum-digest-with-cloud-kms-services-section --omit=dev
COPY services/account-abstraction-services-section/services/erc-4337-bundler-service/package*.json ./
RUN npm install --omit=dev
COPY services/account-abstraction-services-section/services/erc-4337-bundler-service/src ./src
COPY services/account-abstraction-services-section/services/erc-4337-bundler-service/bin ./bin
ENV HOST=0.0.0.0 PORT=8080
CMD ["node","bin/serve-kms-bundler.mjs"]
