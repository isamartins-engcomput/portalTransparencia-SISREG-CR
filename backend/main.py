from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os
import requests
import json

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

URL_BASE_SISREG = "https://sisreg-es.saude.gov.br/solicitacao-ambulatorial-ms-tres-lagoas"

@app.get("/api/consulta/{cpf_usuario}")
def consultar_cpf(cpf_usuario: str):
    
    USUARIO = os.getenv("SISREG_USUARIO")
    SENHA = os.getenv("SISREG_SENHA")

    print("\n" + "="*60)
    print("|=========| NOVA REQUISIÇÃO RECEBIDA DO FRONTEND |=========|")
    print("="*60)

    try:

        cpf_limpo = cpf_usuario.replace(".", "").replace("-", "")
        print(f"[INFO] CPF Original: {cpf_usuario}")
        print(f"[INFO] CPF Limpo para busca: {cpf_limpo}")

        payload = {
            "query": {
                "bool": {
                    "must": [
                        {"term": {"cpf_usuario": cpf_limpo}}
                    ]
                }
            },
            "size": 10000
        }
        
        endpoint_final = URL_BASE_SISREG + "/_search"
        print(f"[INFO] Conectando ao SISREG...")
        print(f"[INFO] URL Alvo: {endpoint_final}")

        response = requests.post(
            endpoint_final, 
            json=payload, 
            headers={"Content-Type": "application/json"}, 
            auth=(USUARIO,SENHA), 
            timeout=30
        )
        
        print(f"[RESPOSTA] Status Code: {response.status_code}")

        if (response.status_code == 200):
            dados = response.json()
            total_hits = dados.get("hits", {}).get("total", 0)
            
            if (isinstance(total_hits, dict)):
                total_hits = total_hits.get("value", 0)

            print(f"[SUCESSO!] Registros encontrados: {total_hits}")
            
            resultados = dados.get("hits", {}).get("hits", [])
            return resultados
            
        else:
            print(f"[ERRO!] Falha na API do Governo:")
            print(f"Detalhe: {response.text}")
            response.raise_for_status()

    except Exception as e:
        print(f"[ERRO CRÍTICO!] Exceção no Backend: {e}")
        return []
    
    finally:
        print("="*60 + "\n")