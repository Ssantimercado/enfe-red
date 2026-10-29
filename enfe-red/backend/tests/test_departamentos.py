"""Departamentos de Mendoza para el filtro por zona de la cartilla."""
import unittest

from services.departamentos import DEPARTAMENTOS, departamento_de, zona_de
from services.ia_busqueda import interpretar_con_reglas


class DepartamentosTest(unittest.TestCase):
    def test_reconoce_el_departamento_como_lo_escriba_cada_uno(self):
        casos = {
            'Mendoza Capital': 'Ciudad de Mendoza', 'capital': 'Ciudad de Mendoza', 'Mendoza': 'Ciudad de Mendoza',
            'Godoy Cruz, Mendoza': 'Godoy Cruz', 'guaymallen': 'Guaymallén', 'Depto. Maipú': 'Maipú',
            'Chacras de Coria': 'Luján de Cuyo', 'El Challao': 'Las Heras', 'San Rafael': 'San Rafael',
        }
        for escrito, departamento in casos.items():
            with self.subTest(escrito=escrito):
                self.assertEqual(departamento_de(escrito), departamento)
        self.assertEqual(len(DEPARTAMENTOS), 18)

    def test_lo_que_no_es_un_departamento_queda_como_esta(self):
        self.assertIsNone(departamento_de('Córdoba'))
        self.assertEqual(zona_de('  Villa  Carlos Paz '), 'Villa Carlos Paz')
        self.assertIsNone(zona_de(''))
        # "centro" o "ciudad" sueltos valen solo como zona completa, no dentro de otro texto.
        self.assertIsNone(departamento_de('centro de salud'))

    def test_la_busqueda_asistida_entiende_los_otros_nombres(self):
        permitidos = {'especialidades': [], 'ciudades': ['Ciudad de Mendoza', 'Godoy Cruz', 'Luján de Cuyo'],
                      'servicios': []}
        for texto, ciudad in (('enfermera en Capital', 'Ciudad de Mendoza'),
                              ('vivo en Chacras de Coria', 'Luján de Cuyo'),
                              ('en Godoy Cruz, Mendoza', 'Godoy Cruz')):
            with self.subTest(texto=texto):
                self.assertEqual(interpretar_con_reglas(texto, permitidos)['ciudad'], ciudad)


if __name__ == '__main__':
    unittest.main()
