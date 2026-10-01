import pandas as pd

RAW_PATH = "data/raw/german_credit.data"

# Attribute order of the UCI Statlog (German Credit) file; last column is the label (1 = good, 2 = bad).
FIELD_NAMES = [
    "checking_status", "duration_months", "credit_history", "purpose", "credit_amount",
    "savings_status", "employment_since", "installment_rate_pct_income", "personal_status_sex",
    "other_debtors", "residence_since", "property", "age_years", "other_installment_plans",
    "housing", "existing_credits", "job", "num_dependents", "telephone", "foreign_worker",
]


def load_raw():
    df = pd.read_csv(RAW_PATH, sep=" ", header=None)
    X = df.iloc[:, :-1]
    X.columns = FIELD_NAMES
    y = (df.iloc[:, -1] == 1).astype(int).values
    return X, y


def categorical_fields(X):
    return [c for c in X.columns if X[c].astype(str).str.match(r'^A\d+$').any()]


def encode(rows, reference):
    """One-hot `rows` exactly as the full dataset `reference` is encoded: same dummy columns, same order."""
    cat_cols = categorical_fields(reference)
    columns = pd.get_dummies(reference, columns=cat_cols).columns
    return pd.get_dummies(rows, columns=cat_cols).reindex(columns=columns, fill_value=0).astype(float)


def load():
    X, y = load_raw()
    return encode(X, X).values, y
