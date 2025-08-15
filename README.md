<div align="center">

# 🎙️ VoiceFlow AI

**A proof-of-concept for a fully voice-controlled AI assistant that can remember your conversations.**

## 🌟 Features

![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)

</div>

---

This project is a complete, end-to-end conversational agent built to feel like a natural, voice-first experience. It's designed to understand what you say, remember the context of the conversation, and respond with a synthesized voice, all in real time.

---

### Core Capabilities
- **Voice-to-Voice Conversations**: Speak naturally and receive AI responses in Murf AI's natural voice
- **Persistent Chat History**: AI remembers previous conversations across sessions
- **Real-time Transcription**: Convert speech to text using AssemblyAI
- **Intelligent Responses**: Powered by Google Gemini API
- **Modern UI**: Glass-morphism design with smooth animations
- **Error Handling**: Graceful fallbacks when APIs are unavailable

### Technical Features
- **FastAPI Backend**: Modern, async Python web framework
- **Session Management**: Unique conversation sessions via URL parameters
- **Audio Processing**: Record, upload, and process audio files
- **Multi-API Integration**: Seamless integration with multiple AI services
- **Responsive Design**: Works on desktop and mobile devices

---

## 🛠️ The Tech Behind It

| Category      | Technology / Service                                       |
|---------------|------------------------------------------------------------|
| **Backend** | Python, FastAPI                                            |
| **Frontend** | HTML, CSS, JavaScript                                      |
| **AI Services** |                                                            |
| ↳ Language Model | [Google Gemini](https://aistudio.google.com/)            |
| ↳ Speech-to-Text | [AssemblyAI](https://www.assemblyai.com/)                |
| ↳ Text-to-Speech | [Murf AI](https://murf.ai/)                              |

---

## 🚀 How to Get It Running

Here’s how to get a copy of the project running on your own machine.

### What You'll Need

- Python 3.8 or newer.
- pip (Python package manager)
- API keys from Murf AI, AssemblyAI, and Google AI Studio.

### Installation and Setup

1.  **Clone the Repository**
    ```sh
    git clone https://github.com/Ayu-shTiwari/VoiceAgent.git
    cd voiceflow-ai
    ```

2.  **Set Up a Virtual Environment**
    ```sh
    # On macOS or Linux
    python3 -m venv venv
    source venv/bin/activate

    # On Windows
    python -m venv venv
    .\venv\Scripts\activate
    ```

3.  **Install the Dependencies**
    ```sh
    pip install -r requirements.txt
    ```

4.  **Set Up Your API Keys**
    - Create a file named `.env` in the main project folder.
    - Add your API keys to this file like so:
      ```env
      MURF_API_KEY="your_murf_api_key_here"
      ASSEMBLYAI_API_KEY="your_assemblyai_api_key_here"
      GEMINI_API_KEY="your_gemini_api_key_here"
      ```

### Running the App

1.  **Start the Server**
    ```sh
    uvicorn app:app --reload
    ```

2.  **Open in Your Browser**
    - Go to `http://127.0.0.1:8000`, and you should see the app running.

---

## 🗺️ How It Works

Here’s a quick look at the journey your voice takes when you use the app:

```mermaid
graph TD
    A[You Speak] -->|Your Voice| B(Browser);
    B -->|Sends Audio to| C{Our Python Server};
    C -->|Forwards to| D[AssemblyAI];
    D -->|Sends Text Back to| C;
    C -->|Sends Text + History to| E[Google Gemini];
    E -->|Sends AI Response to| C;
    C -->|Sends Response to| F[Murf AI];
    F -->|Creates Audio File & Sends URL to| C;
    C -->|Sends Audio URL Back to| B;
    B -->|Plays the Audio| G[You Hear the Response];
```
