from flask import Flask, jsonify
from flask_cors import CORS # Necesario para que React pueda llamar a esta API

app = Flask(__name__)
CORS(app) # Habilita CORS para todas las rutas

# Datos simulados del enfermero (en producción, esto vendría de Supabase)
perfil_enfermero = {
    "id": 1,
    "foto_url": "https://randomuser.me/api/portraits/men/32.jpg", # Foto de ejemplo
    "nombre_completo": "Juan Carlos García López",
    "edad": 34,
    "titulos": [
        "Licenciado en Enfermería (Universidad de Buenos Aires)",
        "Especialidad en Cuidados Intensivos (2018)",
        "Diplomado en Liderazgo en Salud (2021)"
    ],
    "direccion": "Calle Falsa 123, Maipú, Mendoza, Argentina",
    "certificado_profesional_verificado": True
}

@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "mensaje": "API de Enfer-Red funcionando correctamente",
        "endpoint_perfil": "http://127.0.0.1:5000/api/perfil/1"
    })

@app.route('/api/perfil/1', methods=['GET'])
def obtener_perfil():
    return jsonify(perfil_enfermero)

if __name__ == '__main__':
    app.run(debug=True, port=5000)