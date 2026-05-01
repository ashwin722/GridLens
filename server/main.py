import os
import io

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
from supabase import create_client, Client

# Load the hidden variables from the .env file
load_dotenv()

app = FastAPI()

# Allow React app to talk to Python server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_methods=["*"],
    allow_headers=["*"],
)

# Grab the credentials securely from the environment
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

@app.post("/upload")
async def upload_excel(file: UploadFile = File(...)):
    # 1. Verify it is an Excel file
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="File must be an Excel format (.xlsx or .xls)")
    
    try:
        # 2. Read the Excel file into memory
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents))
        
        # 3. Map the Excel columns exactly to our database columns
        column_mapping = {
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
        
        # Rename columns and drop any that don't match our database
        df.rename(columns=column_mapping, inplace=True)
        valid_columns = list(column_mapping.values())
        df = df[[col for col in df.columns if col in valid_columns]]
        
        # --- 4. THE BULLETPROOF DATA CLEANING ---
        
        # Drop accidental blank rows at the bottom of the Excel sheet
        df = df.dropna(subset=['id'])
        
        # Explicitly declare which columns must be strict whole numbers
        int_columns = ['id', 'quantity', 'balance_unit', 'shelf_life_months', 'year_code']
        
        for col in int_columns:
            if col in df.columns:
                # to_numeric coerces bad text (like "NOS") to blank
                # round() fixes rogue decimals (like 1.5 -> 2)
                # Int64 enforces strict integer type for Supabase
                df[col] = pd.to_numeric(df[col], errors='coerce').round().astype('Int64')
        
        # The 'value' column represents money, so it CAN have decimals (float)
        if 'value' in df.columns:
            df['value'] = pd.to_numeric(df['value'], errors='coerce')
        
        # Convert all Pandas missing types (NaN, NA) to pure Python None for Supabase
        df = df.replace({float('nan'): None, pd.NA: None})
        
        # --- 5. UPLOAD TO DATABASE ---
        
        # Convert to a list of dictionaries
        records = df.to_dict(orient='records')
        
        # Bulk Insert/Upsert into Supabase
        response = supabase.table('inventory').upsert(records).execute()
        
        return {
            "message": "Upload successful!", 
            "rows_processed": len(records)
        }
        
    except Exception as e:
        print(f"Error processing upload: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))