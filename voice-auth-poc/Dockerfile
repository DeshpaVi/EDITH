FROM public.ecr.aws/lambda/python:3.12
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir speechbrain numpy boto3
COPY app/ ${LAMBDA_TASK_ROOT}/
# Bake the model in at build time; never download at cold start.
RUN cd ${LAMBDA_TASK_ROOT} && MODEL_DIR=/opt/model python -c "import embed; embed.encoder()"
CMD ["handler.verify_handler"]
