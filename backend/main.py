from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import requests
import json
import os
from dotenv import load_dotenv

load_dotenv()
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

URL_BASE_SISREG = "https://sisreg-es.saude.gov.br/solicitacao-ambulatorial-ms-tres-lagoas"

@app.get("/api/consulta/{cpf}")

def consultar_cpf(cpf: str):
    
    USUARIO = os.getenv("SISREG_USUARIO")
    SENHA = os.getenv("SISREG_SENHA")

    print("\n" + "="*60)
    print("|=========| NOVA REQUISIÇÃO RECEBIDA DO FRONTEND |=========|")
    print("="*60)

    try:

        cpf_limpo = cpf.replace(".", "").replace("-", "")
        print(f"[INFO] CPF Original: {cpf}")
        print(f"[INFO] CPF Limpo para busca: {cpf_limpo}")

        payload = {
            "query": {
                "bool": {
                    "must": [
                        {"term": {"cpf_usuario.keyword": cpf_limpo}}
                    ]
                }
            },
            "_source": [
                 "status_solicitacao", 
                 "data_solicitacao", 
                 "descricao_procedimento",
                 "nome_unidade_solicitante",
                 "classificacao_risco",
                 "no_usuario",
                 "dt_nascimento_usuario"
            ]
        }

        if (cpf_limpo == "000"):
            print("[TESTE] Retornando dados fictícios para teste de layout...")
            return [{
                "_source": {
                    "no_usuario": "ISADORA MARTINS TESTE",
                    "dt_nascimento_usuario": "2006-06-19",
                    "data_solicitacao": "2025-10-15",
                    "descricao_procedimento": "CONSULTA CARDIOLÓGICA",
                    "status_solicitacao": "AGENDADO",
                    "nome_unidade_solicitante": "UBS VILA PILOTO",
                    "classificacao_risco": "AMARELO"
                }
            },
            {
                "_source": {
                    "no_usuario": "ISADORA MARTINS TESTE",
                    "dt_nascimento_usuario": "2006-06-19",
                    "data_solicitacao": "2025-11-01",
                    "descricao_procedimento": "EXAME DE SANGUE COMPLETO",
                    "status_solicitacao": "PENDENTE",
                    "nome_unidade_solicitante": "HOSPITAL NOSSA SENHORA AUXILIADORA",
                    "classificacao_risco": "AZUL"
                }
            }]
        
        endpoint_final = URL_BASE_SISREG + "/_search"
        print(f"[INFO] Conectando ao SISREG...")
        print(f"[INFO] URL Alvo: {endpoint_final}")
        print(f"[INFO] Usuário: {USUARIO}")

        response = requests.post(
            endpoint_final, 
            json=payload, 
            headers={"Content-Type": "application/json"}, 
            auth=(USUARIO,SENHA), 
            timeout=20
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