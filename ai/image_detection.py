from ultralytics import YOLO
import cv2

# Charger le modèle YOLO (assurez-vous que le chemin vers le modèle est correct)
model = YOLO("ai/TheBest.pt")

# Charger l'image à tester
image_path = "ai/assets/2.jpg"
img = cv2.imread(image_path)
if img is None:
    raise Exception(f"L'image n'a pas pu être chargée depuis : {image_path}")

# Effectuer la détection (résultat sous forme de liste)
results = model(img)

# Accéder au premier résultat (pour une seule image)
result = results[0]

# Afficher l'image annotée (une fenêtre s'ouvrira)
result.show()

# Sauvegarder l'image annotée dans le dossier 'resultats'
result.save("resultats/")