from ultralytics import YOLO
import cv2
import time

# Charger le modèle YOLO (assurez-vous que le chemin vers le modèle est correct)
model = YOLO("ai/TheBest.pt")

# Utiliser la caméra par défaut (0)
cap = cv2.VideoCapture(0)

# Vérifier si la caméra s'est ouverte correctement
if not cap.isOpened():
    raise Exception("Impossible d'accéder à la caméra")

# Variables pour calculer les FPS
prev_time = 0
fps = 0

print("Appuyez sur 'q' pour quitter")

while True:
    # Lire une frame depuis la caméra
    ret, frame = cap.read()
    if not ret:
        print("Échec de la lecture de la frame")
        break
    
    # Calculer les FPS
    current_time = time.time()
    fps = 1 / (current_time - prev_time) if (current_time - prev_time) > 0 else 0
    prev_time = current_time
    
    # Effectuer la détection
    results = model(frame)
    result = results[0]
    
    # Obtenir l'image annotée
    annotated_frame = result.plot()
    
    # Afficher les FPS
    cv2.putText(annotated_frame, f"FPS: {int(fps)}", (20, 30), 
                cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
    
    # Afficher la frame annotée
    cv2.imshow("Real-time Object Detection", annotated_frame)
    
    # Quitter si 'q' est pressé
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# Libérer les ressources
cap.release()
cv2.destroyAllWindows()