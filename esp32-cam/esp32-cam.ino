#include "esp_camera.h"
#include "Arduino.h"
#include <WiFi.h>
#include <esp_http_server.h>

// Camera model pins (for ESP32-CAM AiThinker)
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

#define AP_SSID "ESP32-CAM"
#define AP_PASS "12345678"

// Function to initialize the camera
bool initCamera() {
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

  // Set frame size and quality
  if (psramFound()) {
    config.frame_size = FRAMESIZE_VGA; // 640x480 (medium resolution)
    config.jpeg_quality = 10;
    config.fb_count = 2;
  } else {
    config.frame_size = FRAMESIZE_VGA; // 640x480 (medium resolution)
    config.jpeg_quality = 12;
    config.fb_count = 1;
  }

  // Initialize the camera
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed with error 0x%x", err);
    return false;
  }
  return true;
}

// MJPEG stream handler
esp_err_t streamHandler(httpd_req_t *req) {
  camera_fb_t *fb = NULL;
  char *partHeader = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";
  static char buffer[64];

  // Set HTTP response headers for MJPEG
  httpd_resp_set_type(req, "multipart/x-mixed-replace; boundary=frame");

  while (true) {
    fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("Camera capture failed");
      httpd_resp_send_500(req);
      return ESP_FAIL;
    }

    // Send frame boundary
    httpd_resp_send_chunk(req, "--frame\r\n", strlen("--frame\r\n"));

    // Send frame headers
    int headerLen = snprintf(buffer, sizeof(buffer), partHeader, fb->len);
    httpd_resp_send_chunk(req, buffer, headerLen);

    // Send frame data
    httpd_resp_send_chunk(req, (const char *)fb->buf, fb->len);

    // Release the frame buffer
    esp_camera_fb_return(fb);
    
    // Add delay to limit to ~5fps (1000ms/5 = 200ms)
    delay(200);
  }

  return ESP_OK;
}

// Start the HTTP server
void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  httpd_handle_t server = NULL;

  // Start the HTTP server
  if (httpd_start(&server, &config) == ESP_OK) {
    httpd_uri_t streamUri = {
      .uri = "/stream",
      .method = HTTP_GET,
      .handler = streamHandler,
      .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &streamUri);
  }
}

void setup() {
  Serial.begin(115200);

  // Initialize the camera
  if (!initCamera()) {
    Serial.println("Camera initialization failed");
    while (1);
  }

  // Start Wi-Fi in Access Point mode
  WiFi.softAP(AP_SSID, AP_PASS);
  Serial.println("Wi-Fi started");
  Serial.print("Access Point IP: ");
  Serial.println(WiFi.softAPIP());

  // Start the camera server
  startCameraServer();
}

void loop() {
  // Nothing to do here, the server handles everything
}
