FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir numpy requests transformers
COPY server.py .
EXPOSE 8000
CMD ["python", "server.py"]
