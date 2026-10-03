import pandas as pd

RAW_PATH = "data/raw/german_credit.data"

# Attribute order of the UCI Statlog (German Credit) file; last column is the label (1 = good, 2 = bad).
FIELD_NAMES = [
    "checking_status", "duration_months", "credit_history", "purpose", "credit_amount",
    "savings_status", "employment_since", "installment_rate_pct_income", "personal_status_sex",
    "other_debtors", "residence_since", "property", "age_years", "other_installment_plans",
    "housing", "existing_credits", "job", "num_dependents", "telephone", "foreign_worker",
]

# What each attribute and A-code means, from the dataset's documentation (UCI Statlog german.doc).
# Amounts are in Deutsche Mark (DM).
FIELD_DOCS = {
    "checking_status": "Status of the existing checking account",
    "duration_months": "Loan duration in months",
    "credit_history": "Credit history",
    "purpose": "Purpose of the loan",
    "credit_amount": "Credit amount (DM)",
    "savings_status": "Savings account / bonds",
    "employment_since": "Present employment since",
    "installment_rate_pct_income": "Installment rate as % of disposable income (1-4)",
    "personal_status_sex": "Personal status and sex",
    "other_debtors": "Other debtors / guarantors",
    "residence_since": "Present residence since (years, 1-4)",
    "property": "Property",
    "age_years": "Age in years",
    "other_installment_plans": "Other installment plans",
    "housing": "Housing",
    "existing_credits": "Number of existing credits at this bank",
    "job": "Job",
    "num_dependents": "Number of people liable to provide maintenance for",
    "telephone": "Telephone",
    "foreign_worker": "Foreign worker",
}
CODE_MEANINGS = {
    "A11": "< 0 DM", "A12": "0 to < 200 DM", "A13": ">= 200 DM / salary paid in for 1+ year", "A14": "no checking account",
    "A30": "no credits taken / all paid back duly", "A31": "all credits at this bank paid back duly",
    "A32": "existing credits paid back duly till now", "A33": "delays in paying off in the past",
    "A34": "critical account / credits at other banks",
    "A40": "car (new)", "A41": "car (used)", "A42": "furniture / equipment", "A43": "radio / television",
    "A44": "domestic appliances", "A45": "repairs", "A46": "education", "A47": "vacation", "A48": "retraining",
    "A49": "business", "A410": "others",
    "A61": "< 100 DM", "A62": "100 to < 500 DM", "A63": "500 to < 1000 DM", "A64": ">= 1000 DM",
    "A65": "unknown / no savings account",
    "A71": "unemployed", "A72": "< 1 year", "A73": "1 to < 4 years", "A74": "4 to < 7 years", "A75": ">= 7 years",
    "A91": "male: divorced / separated", "A92": "female: divorced / separated / married", "A93": "male: single",
    "A94": "male: married / widowed", "A95": "female: single",
    "A101": "none", "A102": "co-applicant", "A103": "guarantor",
    "A121": "real estate", "A122": "building society savings / life insurance", "A123": "car or other",
    "A124": "unknown / no property",
    "A141": "bank", "A142": "stores", "A143": "none",
    "A151": "rent", "A152": "own", "A153": "for free",
    "A171": "unemployed / unskilled, non-resident", "A172": "unskilled, resident",
    "A173": "skilled employee / official", "A174": "management / self-employed / highly qualified",
    "A191": "none", "A192": "yes, registered under the customer's name",
    "A201": "yes", "A202": "no",
}


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
