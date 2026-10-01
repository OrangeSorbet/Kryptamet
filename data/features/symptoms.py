"""Binary symptom-indicator vector in the training column order."""
import numpy as np


def featurize(symptom_names, present):
    present = set(present)
    x = np.array([1.0 if s in present else 0.0 for s in symptom_names])
    on = [i for i, s in enumerate(symptom_names) if s in present]
    return {
        "x": x,
        "feature_names": list(symptom_names),
        "x_captions": [f"symptom '{s}' present (1) / absent (0)" for s in symptom_names],
        "feature_trace": [{
            "name": "indicator_vector",
            "raw_computation": (f"{len(symptom_names)} symptom slots; 1 at x{on} "
                                f"({', '.join(symptom_names[i] for i in on)}), 0 elsewhere"),
            "value": float(len(on)),
            "why": "The model was trained on the same 0/1 symptom table, one column per symptom in this order.",
            "next": "This vector is what gets encrypted next, so the server scores every diagnosis without seeing your symptoms.",
        }],
        "input_echo": {"symptoms": [symptom_names[i] for i in on]},
    }
