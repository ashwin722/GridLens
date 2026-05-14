"""
GridLens Backend API

This FastAPI application serves as the bridge between the React frontend and the Supabase database.
It handles fetching large datasets and securely processing/cleaning Excel uploads before 
syncing them to the cloud database.
"""

import os
import io
import json
import math
import re
from pathlib import Path
import numpy as np
import pandas as pd

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client

# --- ENVIRONMENT SETUP ---
# Load secret variables from the .env file (Supabase URL and Service Key)
load_dotenv()

# Initialize FastAPI application
app = FastAPI(title="GridLens API", version="1.0.0")
API_VERSION = "1.2.0"

# --- CORS CONFIGURATION ---
# Allows the React frontend to communicate with this Python backend.
# Note for future: In a strict production environment, replace ["*"] with your exact Vercel URL.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- DATABASE CONNECTION ---
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

# Validate that credentials exist to prevent obscure errors later
if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise ValueError("Missing Supabase credentials in .env file.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

DATASET_TABLES = {
    "surplus": os.getenv("SURPLUS_TABLE", "inventory"),
    "vendor": os.getenv("VENDOR_TABLE", "vendor"),
}
UPLOADS_TABLE = os.getenv("UPLOADS_TABLE", "gridlens_uploads")
DATA_DIR = Path(__file__).resolve().parent / "data"

DATASET_ROUTES = {
    "surplus": ["/inventory", "/surplus", "/datasets/surplus", "/api/inventory", "/api/surplus", "/api/datasets/surplus"],
    "vendor": ["/vendor", "/vendors", "/datasets/vendor", "/api/vendor", "/api/vendors", "/api/datasets/vendor"],
}


# --- CONSTANTS ---
# OPTIMIZATION: Moving this mapping outside the function means Python only creates it once 
# when the server starts, rather than recreating it on every single upload request.
COLUMN_MAPPING = {
    'S.No': 'id',
    'Item Code': 'item_code',
    'Name': 'name',
    'OEM No': 'oem_no',
    'Unnamed: 4': 'item_name', 
    'Item Name': 'item_name',  
    'Description': 'description',
    'Category': 'category',
    'Subcategory': 'subcategory',
    'Make': 'make',
    'Segment': 'segment',
    'Shelf Life(months)': 'shelf_life_months',
    'Year Code': 'year_code',
    'Unit': 'unit',
    'Quantity': 'quantity',
    'Balance Unit': 'balance_unit',
    'Value': 'value',
    'Status': 'status',
    'Location': 'location',
    'Remarks': 'remarks'
}


def normalize_column_name(column_name):
    """Convert an Excel header into a safe database column name."""
    mapped_name = COLUMN_MAPPING.get(str(column_name).strip())
    if mapped_name:
        return mapped_name

    normalized = str(column_name).strip().lower()
    normalized = re.sub(r"[^a-z0-9]+", "_", normalized)
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    return normalized or "column"


def normalize_dataframe_columns(df):
    """Normalize headers while keeping every Excel column and avoiding duplicates."""
    seen_columns = {}
    normalized_columns = []

    for column in df.columns:
        base_column = normalize_column_name(column)
        next_column = base_column
        duplicate_index = 2

        while next_column in seen_columns:
            next_column = f"{base_column}_{duplicate_index}"
            duplicate_index += 1

        seen_columns[next_column] = True
        normalized_columns.append(next_column)

    df.columns = normalized_columns
    return df


def clean_cell_value(value):
    """Convert Pandas/Numpy values into JSON-safe Python values."""
    if value is None or value is pd.NA:
        return None

    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value

    if isinstance(value, (np.integer,)):
        return int(value)

    if isinstance(value, (np.floating,)):
        value = float(value)
        if math.isnan(value) or math.isinf(value):
            return None
        return value

    if isinstance(value, (pd.Timestamp,)):
        return value.isoformat()

    return value


def dataframe_to_records(df):
    """Convert a cleaned DataFrame into Supabase-ready records."""
    df = df.replace({np.nan: None, np.inf: None, -np.inf: None, pd.NA: None})
    records = df.to_dict(orient='records')

    clean_records = []
    for record in records:
        clean_records.append({
            key: clean_cell_value(value)
            for key, value in record.items()
        })

    return clean_records


def dataset_file_path(dataset):
    return DATA_DIR / f"{dataset}.json"


def save_dataset_file(dataset, records):
    DATA_DIR.mkdir(exist_ok=True)
    with dataset_file_path(dataset).open("w", encoding="utf-8") as file:
        json.dump(records, file, ensure_ascii=False, allow_nan=False)


def load_dataset_file(dataset):
    path = dataset_file_path(dataset)
    if not path.exists():
        return None

    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def remove_dataset_file(dataset):
    path = dataset_file_path(dataset)
    if path.exists():
        path.unlink()


def fetch_supabase_table(table_name):
    try:
        response = supabase.table(table_name) \
            .select("*") \
            .limit(10000) \
            .execute()
    except Exception as e:
        error_message = str(e)
        if "PGRST205" in error_message or "Could not find the table" in error_message:
            print(f"Supabase table '{table_name}' not found. Returning empty dataset.")
            return []
        raise

    return response.data


def fetch_uploaded_dataset(dataset):
    try:
        response = supabase.table(UPLOADS_TABLE) \
            .select("records") \
            .eq("dataset", dataset) \
            .limit(1) \
            .execute()
    except Exception as e:
        error_message = str(e)
        if "PGRST205" in error_message or "Could not find the table" in error_message:
            return None
        raise

    if not response.data:
        return None

    return response.data[0].get("records")


def save_uploaded_dataset(dataset, records):
    try:
        supabase.table(UPLOADS_TABLE).upsert({
            "dataset": dataset,
            "records": records,
        }, on_conflict="dataset").execute()
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Could not permanently save uploaded {dataset} data. "
                f"Create the '{UPLOADS_TABLE}' table from server/supabase_schema.sql, then upload again. "
                f"Original error: {str(e)}"
            ),
        )


def delete_uploaded_dataset(dataset):
    try:
        supabase.table(UPLOADS_TABLE).delete().eq("dataset", dataset).execute()
    except Exception as e:
        error_message = str(e)
        if "PGRST205" in error_message or "Could not find the table" in error_message:
            return
        raise


def replace_table_data(table_name, records):
    """
    Delete existing rows and insert the uploaded records.
    Supabase requires a filter for deletes, so we use a not-null filter on the
    first available column from the incoming sheet.
    """
    if not records:
        return

    delete_column = "id" if "id" in records[0] else next(iter(records[0]))
    supabase.table(table_name).delete().not_.is_(delete_column, "null").execute()

    batch_size = 500
    for start in range(0, len(records), batch_size):
        supabase.table(table_name).insert(records[start:start + batch_size]).execute()


def delete_table_data(table_name):
    records = fetch_supabase_table(table_name)
    if not records:
        return

    delete_column = "id" if "id" in records[0] else next(iter(records[0]))
    supabase.table(table_name).delete().not_.is_(delete_column, "null").execute()


async def require_edit_access(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Login required.")

    token = authorization.split(" ", 1)[1]

    try:
        user_response = supabase.auth.get_user(token)
        user = user_response.user
        if not user or not user.email:
            raise HTTPException(status_code=401, detail="Invalid login session.")

        role_response = supabase.table("user_roles") \
            .select("role") \
            .eq("email", user.email) \
            .single() \
            .execute()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=403, detail="Could not verify edit access.")

    if not role_response.data or role_response.data.get("role") != "GRID_EDIT":
        raise HTTPException(status_code=403, detail="Edit access required.")

    return user


# --- API ENDPOINTS ---

def get_dataset_records(dataset):
    table_name = DATASET_TABLES.get(dataset)
    if not table_name:
        raise HTTPException(status_code=404, detail="Dataset not found.")

    uploaded_data = fetch_uploaded_dataset(dataset)
    if uploaded_data is not None:
        return uploaded_data

    saved_data = load_dataset_file(dataset)
    if saved_data is not None:
        return saved_data

    return fetch_supabase_table(table_name)


@app.get("/")
@app.get("/health")
@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "service": "GridLens API",
        "version": API_VERSION,
        "datasets": list(DATASET_TABLES.keys()),
        "dataset_routes": DATASET_ROUTES,
    }


@app.get("/inventory")
@app.get("/surplus")
@app.get("/datasets/surplus")
@app.get("/api/inventory")
@app.get("/api/surplus")
@app.get("/api/datasets/surplus")
async def get_inventory():
    """Fetches the complete surplus inventory dataset."""
    try:
        return get_dataset_records("surplus")
    
    except Exception as e:
        print(f"Error fetching inventory: {str(e)}")
        # Pass the exact error string to the frontend for easier debugging
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/vendor")
@app.get("/vendors")
@app.get("/datasets/vendor")
@app.get("/api/vendor")
@app.get("/api/vendors")
@app.get("/api/datasets/vendor")
async def get_vendor_inventory():
    """Fetches the complete vendor dataset."""
    try:
        return get_dataset_records("vendor")

    except Exception as e:
        print(f"Error fetching vendor inventory: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/datasets/{dataset}")
async def get_dataset(dataset: str):
    """Fetches any configured dataset by key."""
    try:
        return get_dataset_records(dataset)

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error fetching {dataset} dataset: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/upload")
@app.post("/api/upload")
async def upload_excel(
    dataset: str = "surplus",
    file: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    """
    Accepts an Excel file upload, scans the headers, cleans the values,
    deletes the selected dataset's previous rows, and inserts the new data.
    """
    # 1. Basic File Validation
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="File must be an Excel format (.xlsx or .xls)")

    await require_edit_access(authorization)

    table_name = DATASET_TABLES.get(dataset)
    if not table_name:
        raise HTTPException(status_code=400, detail="Invalid dataset selected.")
    
    try:
        # 2. Read File into Memory
        # Using io.BytesIO prevents needing to save the file to the server's hard drive
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents))

        # 3. Keep all headers from Excel, normalize them for database column names,
        # and remove rows that are completely empty.
        df = normalize_dataframe_columns(df)
        df = df.dropna(how='all')
        clean_records = dataframe_to_records(df)

        # 4. Permanently save the exact uploaded sheet in Supabase JSONB storage.
        # This avoids relying on the backend filesystem, which can be reset by hosts.
        save_uploaded_dataset(dataset, clean_records)
        remove_dataset_file(dataset)

        # 5. Also sync to the legacy row table when it has matching columns.
        # If that schema rejects new Excel headers, the JSONB upload remains durable.
        supabase_synced = True
        supabase_warning = None
        try:
            replace_table_data(table_name, clean_records)
        except Exception as sync_error:
            supabase_synced = False
            supabase_warning = str(sync_error)
            print(f"Supabase sync skipped for {dataset}: {supabase_warning}")
        
        return {
            "message": "Upload successful!", 
            "rows_processed": len(clean_records),
            "supabase_synced": supabase_synced,
            "warning": supabase_warning
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error processing upload: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/datasets/{dataset}")
@app.delete("/api/datasets/{dataset}")
async def remove_dataset(dataset: str, authorization: str | None = Header(default=None)):
    """Manually removes the selected dataset. This is the only explicit delete path."""
    if dataset not in DATASET_TABLES:
        raise HTTPException(status_code=400, detail="Invalid dataset selected.")

    await require_edit_access(authorization)

    table_name = DATASET_TABLES[dataset]

    delete_uploaded_dataset(dataset)
    remove_dataset_file(dataset)

    try:
        delete_table_data(table_name)
    except Exception as e:
        print(f"Legacy table cleanup skipped for {dataset}: {str(e)}")

    return {"message": "Dataset removed.", "dataset": dataset}
