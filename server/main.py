"""
GridLens Backend API

This FastAPI application serves as the bridge between the React frontend and the Supabase database.
It handles fetching large datasets and securely processing/cleaning Excel uploads before 
syncing them to the cloud database.
"""

import os
import io
import math
import numpy as np
import pandas as pd

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client

# --- ENVIRONMENT SETUP ---
# Load secret variables from the .env file (Supabase URL and Service Key)
load_dotenv()

# Initialize FastAPI application
app = FastAPI(title="GridLens API", version="1.0.0")

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


# --- API ENDPOINTS ---

@app.get("/inventory")
async def get_inventory():
    """
    Fetches the complete inventory dataset from Supabase.
    Overrides the default PostgREST 1,000 row limit to ensure the frontend 
    receives all records (up to 10,000) for the AG-Grid display.
    """
    try:
        response = supabase.table('inventory') \
            .select("*") \
            .order('id') \
            .limit(10000) \
            .execute()
        
        return response.data
    
    except Exception as e:
        print(f"Error fetching inventory: {str(e)}")
        # Pass the exact error string to the frontend for easier debugging
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/upload")
async def upload_excel(file: UploadFile = File(...)):
    """
    Accepts an Excel file upload, maps the columns to the database schema, 
    aggressively cleans the data to ensure JSON/PostgreSQL compliance, 
    and upserts the records into Supabase.
    """
    # 1. Basic File Validation
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="File must be an Excel format (.xlsx or .xls)")
    
    try:
        # 2. Read File into Memory
        # Using io.BytesIO prevents needing to save the file to the server's hard drive
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents))
        
        # 3. Standardize Columns
        # Rename columns based on our mapping and drop any extra columns that don't belong in the DB
        df.rename(columns=COLUMN_MAPPING, inplace=True)
        valid_columns = list(COLUMN_MAPPING.values())
        df = df[[col for col in df.columns if col in valid_columns]]
        
        # --- DATA CLEANING PIPELINE ---
        
        # Drop rogue blank rows at the bottom of the Excel sheet
        df = df.dropna(subset=['id'])
        
        # Enforce strict Integer types (e.g., ID, Year)
        # Using Pandas 'Int64' (capital I) allows the column to hold integers AND nulls safely
        int_columns = ['id', 'shelf_life_months', 'year_code']
        for col in int_columns:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce').round().astype('Int64')

        # Enforce Float types for quantities and money to preserve decimals (e.g., 102.3)
        decimal_columns = ['quantity', 'balance_unit', 'value']
        for col in decimal_columns:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce')

        # First pass at null conversion: Swap Pandas NaNs for Python Nones
        df = df.replace({np.nan: None, np.inf: None, -np.inf: None, pd.NA: None})
        
        # Convert DataFrame to a list of dictionaries (one dict per row)
        records = df.to_dict(orient='records')

        # --- THE JSON SAFETY NET ---
        # df.to_dict() can sometimes leave microscopic float('nan') objects behind.
        # Standard JSON cannot parse NaN or Infinity. This loop acts as a final filter 
        # to guarantee every single value is 100% JSON compliant before sending to Supabase.
        clean_records = []
        for record in records:
            clean_record = {}
            for key, val in record.items():
                if isinstance(val, float):
                    if math.isnan(val) or math.isinf(val):
                        clean_record[key] = None
                    else:
                        clean_record[key] = val
                else:
                    clean_record[key] = val
            clean_records.append(clean_record)

        # 4. Upsert Data to Database
        # 'upsert' means it will UPDATE existing rows if the ID matches, or INSERT new rows if the ID is new.
        response = supabase.table('inventory').upsert(clean_records).execute()
        
        return {
            "message": "Upload successful!", 
            "rows_processed": len(clean_records)
        }
        
    except Exception as e:
        print(f"Error processing upload: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))