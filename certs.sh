#!/bin/bash

# Note: this is how the certs were created; this script doesn't cleanup and isn't idempotent

SERVER_PASS=$(openssl rand -hex 16)
CLIENT_PASS=$(openssl rand -hex 16)

echo "Generated passwords:"
echo "Server keystore/truststore password: $SERVER_PASS"
echo "Client keystore/truststore password: $CLIENT_PASS"
echo ""

mkdir -p ssl/{ca,server,client}
cd ssl

openssl genrsa -out ca/ca-key.pem 4096
openssl req -new -x509 -key ca/ca-key.pem -out ca/ca-cert.pem -days 730 \
  -subj "/C=US/ST=MN/L=Minneapolis/O=Schmitt Labs/OU=Kafka/CN=Santa Cruz Kafka CA"

openssl genrsa -out server/server-key.pem 4096
openssl req -new -key server/server-key.pem -out server/server.csr \
  -subj "/C=US/ST=MN/L=Minneapolis/O=Schmitt Labs/OU=Kafka/CN=santa-cruz-kafka-0.iainschmitt.com"
openssl x509 -req -in server/server.csr -CA ca/ca-cert.pem -CAkey ca/ca-key.pem \
  -out server/server-cert.pem -days 730 -CAcreateserial

openssl genrsa -out client/client-key.pem 4096
openssl req -new -key client/client-key.pem -out client/client.csr \
  -subj "/C=US/ST=MN/L=Minneapolis/O=Schmitt Labs/OU=Kafka/CN=kafka-client-1"
openssl x509 -req -in client/client.csr -CA ca/ca-cert.pem -CAkey ca/ca-key.pem \
  -out client/client-cert.pem -days 730 -CAcreateserial

cat server/server-cert.pem ca/ca-cert.pem > server/server-cert-chain.pem
cat client/client-cert.pem ca/ca-cert.pem > client/client-cert-chain.pem

echo "Creating JKS keystores..."

openssl pkcs12 -export -in server/server-cert-chain.pem -inkey server/server-key.pem \
  -out server/server.p12 -name kafka-server -passout pass:$SERVER_PASS

keytool -importkeystore -deststorepass $SERVER_PASS -destkeypass $SERVER_PASS \
  -destkeystore server/server.keystore.jks -srckeystore server/server.p12 \
  -srcstoretype PKCS12 -srcstorepass $SERVER_PASS -alias kafka-server

keytool -import -file ca/ca-cert.pem -alias ca-cert \
  -keystore server/server.truststore.jks -storepass $SERVER_PASS -noprompt

openssl pkcs12 -export -in client/client-cert-chain.pem -inkey client/client-key.pem \
  -out client/client.p12 -name kafka-client -passout pass:$CLIENT_PASS

keytool -importkeystore -deststorepass $CLIENT_PASS -destkeypass $CLIENT_PASS \
  -destkeystore client/client.keystore.jks -srckeystore client/client.p12 \
  -srcstoretype PKCS12 -srcstorepass $CLIENT_PASS -alias kafka-client

keytool -import -file ca/ca-cert.pem -alias ca-cert \
  -keystore client/client.truststore.jks -storepass $CLIENT_PASS -noprompt

echo $SERVER_PASS > server/keystore.password
echo $CLIENT_PASS > client/keystore.password

rm server/server.csr client/client.csr server/server.p12 client/client.p12

echo ""
echo "SSL certificates and JKS keystores created successfully!"
echo "Server keystore: ssl/server/server.keystore.jks"
echo "Server truststore: ssl/server/server.truststore.jks"
echo "Client keystore: ssl/client/client.keystore.jks"
echo "Client truststore: ssl/client/client.truststore.jks"
