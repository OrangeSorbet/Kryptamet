"""Traced standardization of one tabular row, optionally with one-hot categorical groups."""

_SCALE_WHY = ("The model was trained on standardized columns: each shifted by its training mean and divided by "
              "its training standard deviation, so a weight's size reflects importance, not the column's units.")


def featurize(raw_row, encoded, scaler, categorical_fields=()):
    """raw_row: {field: raw value}; encoded: pd.Series of unscaled model columns in training order
    (a numeric field's column has the field's name, a one-hot column is '<field>_<code>')."""
    names = [str(n) for n in encoded.index]
    raw = encoded.to_numpy(dtype=float)
    x = scaler.transform(raw[None])[0].astype(float)
    mu, sigma = scaler.mean_, scaler.scale_
    owner = {n: next((f for f in categorical_fields if n.startswith(f + "_")), None) for n in names}

    captions = []
    for i, n in enumerate(names):
        f = owner[n]
        if f is None:
            captions.append(f"z-scored {n} (raw {raw_row[n]:g})")
        else:
            captions.append(f"z-scored one-hot: is {f} {n[len(f) + 1:]}? ({'yes' if raw[i] else 'no'}, yours is {raw_row[f]})")

    steps = []
    for field, value in raw_row.items():
        if field in categorical_fields:
            idx = [i for i, n in enumerate(names) if owner[n] == field]
            codes = [names[i][len(field) + 1:] for i in idx]
            steps.append({
                "name": field,
                "raw_computation": (f"{field} = {value} -> one-hot over {codes} = "
                                    f"{[int(raw[i]) for i in idx]} -> each (v - mean) / std = "
                                    f"[{', '.join(f'{x[i]:.4f}' for i in idx)}]"),
                "value": [float(x[i]) for i in idx],
                "why": "A category has no numeric order, so it becomes one 0/1 column per code; then each column is "
                       "standardized like every other column. " + _SCALE_WHY,
                "next": f"These {len(idx)} numbers fill x[{idx[0]}..{idx[-1]}] of the vector that gets encrypted.",
            })
        else:
            i = names.index(field)
            steps.append({
                "name": field,
                "raw_computation": f"({raw[i]:g} - {mu[i]:.4f}) / {sigma[i]:.4f} = {x[i]:.4f}",
                "value": float(x[i]),
                "raw": float(raw[i]), "mu": float(mu[i]), "sigma": float(sigma[i]),
                "why": _SCALE_WHY,
                "next": f"Becomes x[{i}] of the vector that gets encrypted.",
            })
    steps.append({
        "name": "assemble_vector",
        "raw_computation": f"{len(names)} standardized values in the training column order",
        "value": None,
        "why": "The logistic regression expects exactly this column order; a shifted column would pair values with the wrong weights.",
        "next": "This vector is what gets encrypted next, so the server can compute the weighted sum without seeing your row.",
    })
    return {
        "x": x,
        "feature_names": names,
        "x_captions": captions,
        "feature_trace": steps,
        "input_echo": {"row": dict(raw_row)},
    }
