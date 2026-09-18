from pathlib import Path
from ultralytics import YOLO

MODEL_PATH = Path(__file__).parent / "model" / "best.pt"
model = YOLO(str(MODEL_PATH))


def predict_packaging(image_path):
    result = model.predict(source=image_path, verbose=False)[0]

    probabilities = result.probs.data.cpu().tolist()
    names = result.names

    class_probabilities = {
        str(names[index]).lower(): float(probability)
        for index, probability in enumerate(probabilities)
    }

    good_probability = class_probabilities.get("good", 0.0) * 100
    bad_probability = class_probabilities.get("bad", 0.0) * 100

    classification = (
        "GOOD" if good_probability >= bad_probability else "BAD"
    )

    health_score = round(good_probability, 2)

    if health_score >= 80:
        status = "GREEN"
        recommendation = "Approved for dispatch."
    elif health_score >= 50:
        status = "YELLOW"
        recommendation = "Supervisor inspection required before dispatch."
    else:
        status = "RED"
        recommendation = "Hold dispatch and repair or replace the packaging."

    return {
        "classification": classification,
        "goodProbability": round(good_probability, 2),
        "badProbability": round(bad_probability, 2),
        "healthScore": health_score,
        "status": status,
        "recommendation": recommendation,
        "modelType": "YOLO classification"
    }