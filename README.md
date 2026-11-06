# 🏎️ Cartola Ghost 1v1 - Visualização 3D de Telemetria F1

Visualização 3D em tempo real no estilo de duelo **1x1 Ghost de F1** para o **Cartola Globo**, construída inteiramente com **HTML5, CSS3, e Vanilla JavaScript com WebGL puro (sem Three.js ou bibliotecas externas)**.

---

## 🚀 Como Executar com UV (Recomendado)

O projeto está configurado para execução nativa com o **[uv](https://github.com/astral-sh/uv)**:

```bash
uv run server.py
```

Ou especificando uma porta alternativa se desejar:

```bash
uv run server.py --port 8080
```

Em seguida, abra no seu navegador:
👉 **`http://localhost:8000`**

*(Opcional: Você também pode executar tradicionalmente com `python3 server.py` ou abrir o `index.html` diretamente).*

---

## ⚡ Como Funciona a Dinâmica da Corrida

1. **Conceito F1 Ghost**:
   - O piloto **líder** (maior pontuação acumulada no campeonato) é renderizado como o **Ghost** (holograma translúcido com brilho *fresnel*, linhas de varredura e aura eletro-ciano).
   - O piloto **atrás** é o perseguidor e corre **sem transparência** (sólido, pintura metálica com reflexo especular e propulsores incandescentes).
   - Sempre que há uma alternância na pontuação e um time ultrapassa o outro, ocorre a ultrapassagem física em 3D na pista reta, os papéis de *Ghost* e *Sólido* se invertem suavemente, e o alerta de **OVERTAKE** surge na telemetria!

2. **Pista 3D em Linha Reta**:
   - Drag strip futurista contínua ao longo do eixo `-Z`.
   - **Marcos de Cada Rodada**: Arcos iluminados (*portais de checkpoint*) para cada rodada (da Rodada 1 até a `rodada_atual`), exibindo painéis LED sincronizados (`RODADA 01`, `RODADA 02`...).
   - A distância entre os carros reflete a diferença real de pontos (*gap* acumulado).

3. **Avatares dos Times**:
   - O escudo oficial do time no Cartola (`url_escudo_png`) é renderizado como textura sobre o bico aerodinâmico e sobre a aleta holográfica suspensa da nave.
   - Sistema de fallback inteligente: se a imagem remota sofrer restrições de CORS no navegador, um escudo vetorial procedural nítido com as cores e iniciais do clube é gerado via Canvas 2D em tempo real.

4. **APIs do Cartola**:
   - Consulta inicial de `https://api.cartola.globo.com/mercado/status` para obter a `rodada_atual`.
   - Consulta paralela das rodadas `1` até a atual para ambos os times via `https://api.cartola.globo.com/time/id/{id}/{rodada}`.
   - Cálculo automático da pontuação acumulada (`pontos_campeonato`), maiores pontuadores da rodada e histórico de ultrapassagens.

5. **Áudio Procedural F1 (Web Audio API)**:
   - Ronco sintetizado de motor híbrido V6, efeito de vento de vácuo, *whoosh* ao cruzar pórticos de rodada e fanfarra de ultrapassagem (100% puro, sem arquivos `.mp3`).

---

## 🎮 Controles e Câmeras

- **Play / Pause**: Reproduzir ou pausar o avanço das rodadas.
- **Timeline Slider**: Arraste a barra para navegar livremente entre as rodadas 1 até a rodada atual.
- **Velocidade**: Alterne entre `0.5x`, `1.0x`, `2.0x` e `4.0x`.
- **Câmeras**:
  - `🎥 CHASE`: Visão clássica de perseguição em 3ª pessoa acompanhando o duelo de perto.
  - `🏎️ COCKPIT`: Câmera instalada no bico do perseguidor olhando diretamente para o Ghost à frente.
  - `📺 TV BROADCAST`: Câmera lateral na zebra da pista acompanhando os carros passarem em alta velocidade.
  - `🛸 DRONE`: Visão aérea isométrica para comparar visualmente o *gap*.
- **Órbita Livre**: Clique e arraste o mouse ou touch na tela para girar a câmera em 360°.
- **Áudio F1**: Efeitos sonoros procedurais sintetizados via Web Audio API.

---

## 🛠️ Arquitetura do Projeto

```
cartola-ghost/
├── pyproject.toml        # Configuração do projeto para execução com uv
├── uv.lock               # Lockfile de resolução do uv
├── server.py             # Servidor HTTP + Proxy CORS com metadados PEP 723
├── index.html            # Interface completa do HUD e Canvas WebGL
├── style.css             # Estilização F1 (Dark Mode, Carbon Fiber, Néon)
├── README.md             # Documentação do projeto
└── js/
    ├── math3d.js         # Biblioteca matemática 3D pura (Mat4, Vec3)
    ├── webgl-renderer.js # Motor gráfico WebGL com shaders e malhas 3D
    ├── cartola-service.js# Integração com as APIs do Cartola e acumulador
    ├── sound-fx.js       # Sintetizador de áudio procedural (Web Audio API)
    └── app.js            # Orquestrador da corrida, telemetria e UI
```
