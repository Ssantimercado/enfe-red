from app import db  # O según cómo importes tu instancia de SQLAlchemy

class Disponibilidad(db.Model):
    __tablename__ = 'disponibilidades'

    id = db.Column(db.Integer, primary_key=True)
    enfermero_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), nullable=False)
    dia_semana = db.Column(db.String(20), nullable=False)
    hora_inicio = db.Column(db.Time, nullable=False)
    hora_fin = db.Column(db.Time, nullable=False)

    # Método para convertir el objeto de la BD al JSON acordado
    def to_dict(self):
        return {
            "id": self.id,
            "dia_semana": self.dia_semana,
            "hora_inicio": str(self.hora_inicio),
            "hora_fin": str(self.hora_fin)
        }