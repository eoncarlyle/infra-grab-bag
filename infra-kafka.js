#!/usr/bin/env node

// Podman Kafka Single-Broker Setup

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const CONFIG = {
  KAFKA_VERSION: "7.4.10",
  NETWORK_NAME: "kafka-net",
  ZOOKEEPER_CONTAINER: "zookeeper",
  KAFKA_CONTAINER: "kafka-broker",
  DATA_DIR: path.join("/opt", "kafka-data"),
  ZOOKEEPER_ADDR: "192.168.110.10",
  KAFKA_ADDR: "192.168.110.11",
};

const colors = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  reset: "\x1b[0m",
};

const log = (message) => console.log(`${colors.green}[INFO]${colors.reset} ${message}`);
const warn = (message) => console.log(`${colors.yellow}[WARN]${colors.reset} ${message}`);
const error = (message) => console.log(`${colors.red}[ERROR]${colors.reset} ${message}`);

function execCommand(command, options = {}) {
  try {
    const result = execSync(command, {
      stdio: options.silent ? "pipe" : "inherit",
      encoding: "utf8",
      ...options,
    });
    return { success: true, output: result };
  } catch (err) {
    if (!options.silent) {
      error(`Command failed: ${command}`);
    }
    return { success: false, error: err, output: err.stdout };
  }
}

function commandExists(command) {
  const result = execCommand(`which ${command}`, { silent: true });
  return result.success;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setupDirectories() {
  log("Creating data directories...");

  const dirs = [path.join(CONFIG.DATA_DIR, "zookeeper"), path.join(CONFIG.DATA_DIR, "kafka")];

  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    }
  });

  log("Data directories created");
}

function networkExists(networkName) {
  const result = execCommand(`podman network exists ${networkName}`, {
    silent: true,
  });
  return result.success;
}

function createNetwork() {
  log("Creating Podman network...");

  if (!networkExists(CONFIG.NETWORK_NAME)) {
    const result = execCommand(`podman network create ${CONFIG.NETWORK_NAME}`);
    if (result.success) {
      log(`Network '${CONFIG.NETWORK_NAME}' created`);
    } else {
      error("Failed to create network");
      process.exit(1);
    }
  } else {
    log(`Network '${CONFIG.NETWORK_NAME}' already exists`);
  }
}

function isContainerRunning(containerName) {
  const result = execCommand(`podman ps --format "{{.Names}}" | grep "^${containerName}$"`, {
    silent: true,
  });
  return result.success;
}

function startZookeeper() {
  log("Starting Zookeeper container...");

  execCommand(`podman rm -f ${CONFIG.ZOOKEEPER_CONTAINER}`, { silent: true });

  const command = [
    "podman run -d --user $(id -u):$(id -g)",
    `--replace`,
    `--name ${CONFIG.ZOOKEEPER_CONTAINER}`,
    `--network ${CONFIG.NETWORK_NAME}`,
    `--ip ${CONFIG.ZOOKEEPER_ADDR}`,
    "--restart=always",
    "-p 2181:2181",
    `-v ${CONFIG.DATA_DIR}/zookeeper:/var/lib/zookeeper:Z`,
    "-e ZOOKEEPER_DATA_DIR=/opt/zookeeper-3.6.3/data",
    "-e ZOOKEEPER_DATA_LOG_DIR=/opt/zookeeper-3.6.3/logs",
    "-e ZOOKEEPER_CLIENT_PORT=2181",
    "-e ZOOKEEPER_TICK_TIME=2000",
    "-e ZOOKEEPER_SYNC_LIMIT=2",
    `confluentinc/cp-zookeeper:${CONFIG.KAFKA_VERSION}`,
  ].join(" ");

  const result = execCommand(command);
  if (result.success) {
    log("Zookeeper container started");
  } else {
    error("Failed to start Zookeeper container");
    process.exit(1);
  }
}

async function startKafka() {
  log("Starting Kafka broker container...");

  execCommand(`podman rm -f ${CONFIG.KAFKA_CONTAINER}`, { silent: true });

  log("Waiting for Zookeeper to be ready...");
  await sleep(10000);
  const command = [
    "podman run -d --user $(id -u):$(id -g)",
    `--replace`,
    `--name ${CONFIG.KAFKA_CONTAINER}`,
    `--network ${CONFIG.NETWORK_NAME}`,
    "--restart=always",
    `--ip ${CONFIG.KAFKA_ADDR}`,
    "-p 9092:9092",
    "-p 29092:29092",
    `-v ${CONFIG.DATA_DIR}/kafka:/var/lib/kafka/data:Z`,
    "-e KAFKA_BROKER_ID=1",
    `-e KAFKA_ZOOKEEPER_CONNECT=${CONFIG.ZOOKEEPER_ADDR}:2181`,
    "-e KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://localhost:9092,PLAINTEXT_HOST://localhost:29092",
    "-e KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT",
    "-e KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT",
    "-e KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1",
    "-e KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1",
    "-e KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1",
    "-e KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0",
    "-e KAFKA_AUTO_CREATE_TOPICS_ENABLE=true",
    "-e KAFKA_LOG_RETENTION_MS=-1",
    "-e KAFKA_LOG_RETENTION_BYTES=-1",
    "-e KAFKA_LOG_SEGMENT_MS=86400000",
    "-e KAFKA_LOG_SEGMENT_BYTES=1073741824",
    "-e KAFKA_LOG_RETENTION_CHECK_INTERVAL_MS=300000",
    `confluentinc/cp-kafka:${CONFIG.KAFKA_VERSION}`,
  ].join(" ");

  const result = execCommand(command);
  if (result.success) {
    log("Kafka broker container started");
  } else {
    error("Failed to start Kafka container");
    process.exit(1);
  }
}

async function waitForKafka() {
  log("Waiting for Kafka to be ready...");

  const maxAttempts = 30;
  let attempt = 1;

  while (attempt <= maxAttempts) {
    const result = execCommand(
      `podman exec ${CONFIG.KAFKA_CONTAINER} kafka-topics --bootstrap-server localhost:9092 --list`,
      { silent: true },
    );

    if (result.success) {
      log("Kafka is ready!");
      return true;
    }

    log(`Attempt ${attempt}/${maxAttempts} - Kafka not ready yet...`);
    await sleep(5000);
    attempt++;
  }

  error(`Kafka failed to start properly after ${maxAttempts} attempts`);
  return false;
}

function createAutostartScript() {
  log("Creating auto-start script...");

  const startScriptPath = path.join(os.homedir(), "start-kafka.sh");
  const logFilePath = path.join(os.homedir(), "kafka-autostart.log");

  const scriptContent = `#!/bin/bash
# Auto-start script for Kafka with Podman
# This script will be called on system boot

LOG_FILE="${logFilePath}"

{
    echo "\\$(date): Starting Kafka auto-start script..."

    # Wait for Podman to be available
    timeout=60
    while [ \\$timeout -gt 0 ] && ! podman info &>/dev/null; do
        echo "\\$(date): Waiting for Podman to be available..."
        sleep 2
        ((timeout-=2))
    done

    if ! podman info &>/dev/null; then
        echo "\\$(date): ERROR - Podman not available after waiting"
        exit 1
    fi

    # Start containers if they're not running
    if ! podman ps --format "{{.Names}}" | grep -q "^${CONFIG.ZOOKEEPER_CONTAINER}\\$"; then
        echo "\\$(date): Starting Zookeeper..."
        podman start ${CONFIG.ZOOKEEPER_CONTAINER} || echo "\\$(date): Failed to start Zookeeper"
    fi

    sleep 10

    if ! podman ps --format "{{.Names}}" | grep -q "^${CONFIG.KAFKA_CONTAINER}\\$"; then
        echo "\\$(date): Starting Kafka..."
        podman start ${CONFIG.KAFKA_CONTAINER} || echo "\\$(date): Failed to start Kafka"
    fi

    echo "\\$(date): Kafka auto-start script completed"
} >> "\\$LOG_FILE" 2>&1`;

  fs.writeFileSync(startScriptPath, scriptContent, { mode: 0o755 });

  log("Setting up crontab for auto-start...");

  const getCrontab = execCommand("crontab -l", { silent: true });
  let currentCrontab = getCrontab.success ? getCrontab.output : "";

  const lines = currentCrontab
    .split("\n")
    .filter((line) => line.trim() && !line.includes("start-kafka.sh"));

  lines.push(`@reboot ${startScriptPath}`);

  const tempCrontabFile = "/tmp/kafka-crontab";
  fs.writeFileSync(tempCrontabFile, lines.join("\n") + "\n");
  execCommand(`crontab ${tempCrontabFile}`);
  fs.unlinkSync(tempCrontabFile);

  log(`Auto-start script created at ${startScriptPath}`);
  log("Crontab entry added for automatic startup on reboot");
}

function checkStatus() {
  log("Checking container status...");

  console.log("=== Zookeeper Status ===");
  if (isContainerRunning(CONFIG.ZOOKEEPER_CONTAINER)) {
    console.log("✓ Zookeeper is running");
  } else {
    console.log("✗ Zookeeper is not running");
  }

  console.log("=== Kafka Status ===");
  if (isContainerRunning(CONFIG.KAFKA_CONTAINER)) {
    console.log("✓ Kafka is running");
  } else {
    console.log("✗ Kafka is not running");
  }

  console.log("=== Network Status ===");
  if (networkExists(CONFIG.NETWORK_NAME)) {
    console.log(`✓ Network '${CONFIG.NETWORK_NAME}' exists`);
  } else {
    console.log(`✗ Network '${CONFIG.NETWORK_NAME}' does not exist`);
  }
}

function topicSetup() {
  log("Testing Kafka functionality...");

  const testTopic = "nginx-logs";

  execCommand(
    `podman exec ${CONFIG.KAFKA_CONTAINER} kafka-topics --create --bootstrap-server localhost:9092 --replication-factor 1 --partitions 1 --topic ${testTopic}`,
    { silent: true },
  );

  log("Available topics:");
  execCommand(
    `podman exec ${CONFIG.KAFKA_CONTAINER} kafka-topics --list --bootstrap-server localhost:9092`,
  );
}

function testKafka() {
  log("Testing Kafka functionality...");

  const testTopic = "test-topic";

  execCommand(
    `podman exec ${CONFIG.KAFKA_CONTAINER} kafka-topics --create --bootstrap-server localhost:9092 --replication-factor 1 --partitions 1 --topic ${testTopic}`,
    { silent: true },
  );

  log("Available topics:");
  execCommand(
    `podman exec ${CONFIG.KAFKA_CONTAINER} kafka-topics --list --bootstrap-server localhost:9092`,
  );

  log("Kafka test completed");
}

function stopKafka() {
  log("Stopping Kafka containers...");

  execCommand(`podman stop ${CONFIG.KAFKA_CONTAINER}`, { silent: true });
  execCommand(`podman stop ${CONFIG.ZOOKEEPER_CONTAINER}`, { silent: true });

  log("Containers stopped");
}

function showLogs() {
  log("Showing Kafka logs...");

  const logProcess = spawn("podman", ["logs", "-f", CONFIG.KAFKA_CONTAINER], {
    stdio: "inherit",
  });

  process.on("SIGINT", () => {
    logProcess.kill("SIGINT");
    process.exit(0);
  });
}

async function startKafkaSetup() {
  log("Starting Kafka setup...");

  if (!commandExists("podman")) {
    error("Podman is not installed or not in PATH");
    process.exit(1);
  }

  setupDirectories();
  createNetwork();
  startZookeeper();
  await startKafka();

  const kafkaReady = await waitForKafka();
  if (!kafkaReady) {
    error("Failed to start Kafka properly");
    process.exit(1);
  }

  createAutostartScript();
  checkStatus();
  topicSetup();

  log("Kafka setup completed successfully!");
  log("Kafka is available at localhost:9092");
  log("Zookeeper is available at localhost:2181");
}

async function restartKafka() {
  stopKafka();
  await sleep(5000);
  startZookeeper();
  await startKafka();

  const kafkaReady = await waitForKafka();
  if (kafkaReady) {
    log("Kafka restarted successfully!");
  } else {
    error("Failed to restart Kafka properly");
    process.exit(1);
  }
}

function showHelp() {
  console.log("Usage: node kafka-setup.js [command]");
  console.log("");
  console.log("Commands:");
  console.log("  start   - Start Kafka and Zookeeper (default)");
  console.log("  stop    - Stop all containers");
  console.log("  restart - Restart all containers");
  console.log("  status  - Check container status");
  console.log("  test    - Test Kafka functionality");
  console.log("  logs    - Show Kafka logs");
  console.log("  help    - Show this help");
  console.log("");
  console.log("Examples:");
  console.log("  node kafka-setup.js start");
  console.log("  node kafka-setup.js status");
  console.log("  node kafka-setup.js restart");
}

async function main() {
  const command = process.argv[2] || "start";

  try {
    switch (command) {
      case "start":
        await startKafkaSetup();
        break;
      case "stop":
        stopKafka();
        break;
      case "restart":
        await restartKafka();
        break;
      case "status":
        checkStatus();
        break;
      case "test":
        testKafka();
        break;
      case "logs":
        showLogs();
        break;
      case "help":
      case "--help":
      case "-h":
        showHelp();
        break;
      default:
        error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (err) {
    error(`Execution failed: ${err.message}`);
    process.exit(1);
  }
}

process.on("uncaughtException", (err) => {
  error(`Uncaught exception: ${err.message}`);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  error(`Unhandled rejection at: ${promise}, reason: ${reason}`);
  process.exit(1);
});

process.on("SIGINT", () => {
  console.log("\nReceived SIGINT. Exiting gracefully...");
  process.exit(0);
});

main();
