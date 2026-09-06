from flask import Blueprint, request, jsonify
import random

# Creamos el "Blueprint" para las rutas de autenticación
auth_bp = Blueprint('auth', __name__)

# Diccionario temporal para guardar códigos hasta que Renzo arme la Base de Datos
codigos_recuperacion = {}

@auth_bp.route('/recuperar-password', methods=['POST'])
def solicitar_recuperacion():
    data = request.get_json()
    email = data.get('email')

    if not email:
        return jsonify({"error": "Falta el email"}), 400

    codigo = str(random.randint(100000, 999999))
    codigos_recuperacion[email] = codigo

    # Simulación del email por consola
    print("\n" + "="*40)
    print(" 📧 SIMULACIÓN DE EMAIL - ENFE-RED 📧")
    print(f" Para: {email}")
    print(f" Código de recuperación: {codigo}")
    print("="*40 + "\n")

    return jsonify({"mensaje": "Solicitud procesada"}), 200


@auth_bp.route('/reset-password', methods=['POST'])
def resetear_password():
    data = request.get_json()
    email = data.get('email')
    codigo = data.get('codigo')
    nueva_password = data.get('nueva_password')

    codigo_guardado = codigos_recuperacion.get(email)

    if codigo_guardado and codigo_guardado == codigo:
        # TODO: Cuando Renzo tenga lista la tabla, acá actualizamos la BD
        del codigos_recuperacion[email]
        return jsonify({"mensaje": "Contraseña actualizada"}), 200
    else:
        return jsonify({"error": "Código incorrecto"}), 400