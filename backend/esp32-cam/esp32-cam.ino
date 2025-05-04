#include "esp_camera.h"
#include <WiFi.h>
#include <WiFiClient.h>
#include "esp_timer.h"
#include "img_converters.h"
#include "Arduino.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "driver/rtc_io.h"

// WiFi credentials
const char* ssid = "Hotspot";
const char* password = "12345678";

// Your server details
const char* serverAddress = "192.168.12.1";
const int serverPort = 8000;
const char* streamPath = "/stream";

// Camera pin configuration for AI Thinker ESP32-CAM
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// LED Flash Pin
#define FLASH_LED_PIN 4

// Stream settings
const int captureInterval = 200;      // Time between frames in milliseconds (5 fps)
const int reconnectDelay = 5000;      // Wait 5 seconds before reconnecting
const int connectionTimeout = 10000;  // Connection timeout in milliseconds
const int keepAliveInterval = 30000;  // Send keep-alive every 30 seconds
const int bufferSize = 4096;          // Buffer size for sending frames

// Global variables
WiFiClient client;
unsigned long previousFrameTime = 0;
unsigned long lastConnectionAttempt = 0;
unsigned long lastKeepAlive = 0;
bool isConnecting = false;
int failedConnectionAttempts = 0;
int maxConnectionAttempts = 5;
bool streamActive = false;

// Task handle for WiFi monitoring
TaskHandle_t wifiMonitorTaskHandle = NULL;

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); // Disable brownout detector
  
  Serial.begin(115200);
  delay(1000); // Give serial time to initialize
  Serial.println("\n\nESP32-CAM Stream Client");
  
  // Initialize the flash LED
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);
  
  // Initialize camera with appropriate settings
  initCamera();
  
  // Connect to WiFi
  connectToWiFi();
  
  // Create a task for monitoring WiFi on Core 0
  xTaskCreatePinnedToCore(
    wifiMonitorTask,    // Function to implement the task
    "WiFiMonitor",      // Name of the task
    4096,               // Stack size in words
    NULL,               // Task input parameter
    1,                  // Priority of the task
    &wifiMonitorTaskHandle,  // Task handle
    0                   // Core where the task should run
  );
}

void wifiMonitorTask(void * parameter) {
  while(true) {
    // Check WiFi status
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi connection lost. Reconnecting...");
      connectToWiFi();
    }
    delay(5000); // Check every 5 seconds
  }
}

void initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  
  // Reduced resolution and quality to improve stability
  if (psramFound()) {
    config.frame_size = FRAMESIZE_SVGA;    // 800x600 (reduced from HD)
    config.jpeg_quality = 15;              // Lower quality (0-63, higher = lower quality)
    config.fb_count = 2;                   // Use 2 frame buffers for better stability
  } else {
    config.frame_size = FRAMESIZE_CIF;     // 400x296 (reduced from VGA)
    config.jpeg_quality = 20;              // Lower quality
    config.fb_count = 1;
  }
  
  // Initialize camera
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed with error 0x%x", err);
    delay(1000);
    ESP.restart();
  }
  
  // Apply initial camera settings
  sensor_t * s = esp_camera_sensor_get();
  if (s) {
    // Adjust auto exposure (0 - 1600)
    s->set_aec_value(s, 300);
    // Adjust gain (0 - 30)
    s->set_agc_gain(s, 0);
    // Adjust brightness (-2 to 2)
    s->set_brightness(s, 0);
    // Reduce special effects to None
    s->set_special_effect(s, 0);
    // Lower saturation for more natural colors
    s->set_saturation(s, -1);
    // Adjust WB mode
    s->set_wb_mode(s, 1); // Auto white balance
  }
  
  Serial.println("Camera initialized successfully");
}

void connectToWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  
  Serial.println("Connecting to WiFi...");
  WiFi.disconnect(true);
  delay(1000);
  
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false); // Disable WiFi sleep mode for better stability
  WiFi.begin(ssid, password);
  
  // Wait for connection with timeout
  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 15000) {
    delay(500);
    Serial.print(".");
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
    
    // Configure static IP if needed to prevent DHCP issues
    // Uncomment and modify these lines if you want to use static IP
    /*
    IPAddress ip(192, 168, 1, 200);     // Static IP
    IPAddress gateway(192, 168, 1, 1);  // Gateway
    IPAddress subnet(255, 255, 255, 0); // Subnet mask
    IPAddress dns(8, 8, 8, 8);          // DNS
    if (!WiFi.config(ip, gateway, subnet, dns)) {
      Serial.println("Static IP configuration failed");
    }
    */
  } else {
    Serial.println("\nWiFi connection failed");
  }
}

bool connectToServer() {
  if (client.connected()) {
    return true;
  }
  
  // Check if we've tried too many times recently
  if (failedConnectionAttempts >= maxConnectionAttempts) {
    Serial.println("Too many failed connection attempts. Restarting ESP...");
    delay(1000);
    ESP.restart();
    return false;
  }
  
  // Implement backoff strategy for reconnection
  unsigned long currentTime = millis();
  if (isConnecting || (currentTime - lastConnectionAttempt < reconnectDelay)) {
    return false;
  }
  
  isConnecting = true;
  lastConnectionAttempt = currentTime;
  
  Serial.println("Connecting to server...");
  client.setTimeout(connectionTimeout);
  
  if (client.connect(serverAddress, serverPort)) {
    Serial.println("Connected to server");
    
    // Send proper HTTP POST request header - modified for better compatibility
    client.print("POST ");
    client.print(streamPath);
    client.println(" HTTP/1.1");
    client.print("Host: ");
    client.print(serverAddress);
    client.print(":");
    client.println(serverPort);
    client.println("Content-Type: multipart/x-mixed-replace; boundary=frame");
    client.println("Connection: keep-alive");
    client.println("Cache-Control: no-cache");
    // Remove Transfer-Encoding: chunked as it's causing issues
    client.println();
    
    failedConnectionAttempts = 0;
    streamActive = true;
    lastKeepAlive = millis();
    isConnecting = false;
    return true;
  } else {
    Serial.println("Connection to server failed");
    failedConnectionAttempts++;
    isConnecting = false;
    return false;
  }
}

void sendKeepAlive() {
  if (client.connected()) {
    client.println("\r\n");  // Send empty line as keep-alive
    Serial.println("Sent keep-alive ping");
    lastKeepAlive = millis();
  }
}

void sendCameraFrame() {
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("Camera capture failed");
    return;
  }
  
  if (client.connected() && streamActive) {
    // Send proper multipart boundary
    client.print("\r\n--frame\r\n");
    client.print("Content-Type: image/jpeg\r\n");
    client.print("Content-Length: ");
    client.print(fb->len);
    client.print("\r\n\r\n");
    
    // Send image data in smaller chunks to prevent buffer overflows
    uint8_t *fbBuf = fb->buf;
    size_t fbLen = fb->len;
    size_t sentBytes = 0;
    
    for (size_t n = 0; n < fbLen; n += bufferSize) {
      if (n + bufferSize < fbLen) {
        if (client.write(fbBuf + n, bufferSize) != bufferSize) {
          Serial.println("Write error");
          streamActive = false;
          break;
        }
        sentBytes += bufferSize;
      } else {
        size_t remainder = fbLen - n;
        if (client.write(fbBuf + n, remainder) != remainder) {
          Serial.println("Final write error");
          streamActive = false;
          break;
        }
        sentBytes += remainder;
      }
      
      // Yield to avoid watchdog trigger
      yield();
    }
    
    if (streamActive) {
      Serial.print("Sent frame: ");
      Serial.print(sentBytes);
      Serial.print("/");
      Serial.print(fb->len);
      Serial.println(" bytes");
    }
  }
  
  // Return the frame buffer to be reused
  esp_camera_fb_return(fb);
}

void loop() {
  // Main execution is on Core 1
  
  // Process server connection and streaming
  if (WiFi.status() == WL_CONNECTED) {
    if (!client.connected() || !streamActive) {
      streamActive = false;
      client.stop(); // Make sure to close any existing connections
      if (connectToServer()) {
        Serial.println("Stream active");
        delay(500); // Give server time to process connection
      } else {
        delay(reconnectDelay / 5); // Wait but don't block completely
        return;
      }
    }
    
    // Send keep-alive ping to maintain connection
    unsigned long currentTime = millis();
    if (currentTime - lastKeepAlive >= keepAliveInterval) {
      sendKeepAlive();
    }
    
    // Capture and send frames at specified interval
    if (currentTime - previousFrameTime >= captureInterval) {
      previousFrameTime = currentTime;
      sendCameraFrame();
    }
    
    // Check if client is still connected
    if (!client.connected()) {
      Serial.println("Connection lost");
      streamActive = false;
      client.stop();
    }
  } else {
    // WiFi monitor task will handle reconnection
    delay(1000);
  }
  
  // Give some time to background tasks
  yield();
}
