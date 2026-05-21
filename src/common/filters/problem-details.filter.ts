import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import type { Request, Response } from 'express';

interface ProblemDetails {
  title: string;
  status: number;
  detail: string;
  instance: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getDetailFromHttpExceptionResponse(responseBody: unknown): string {
  if (typeof responseBody === 'string') {
    return responseBody;
  }

  if (isRecord(responseBody)) {
    const message = responseBody.message;
    if (typeof message === 'string') {
      return message;
    }

    if (
      Array.isArray(message) &&
      message.every((item) => typeof item === 'string')
    ) {
      return message.join('; ');
    }

    const error = responseBody.error;
    if (typeof error === 'string') {
      return error;
    }
  }

  return 'Request failed.';
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let detail = 'Internal server error.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      detail = getDetailFromHttpExceptionResponse(exception.getResponse());
    }

    const title = STATUS_CODES[status] ?? 'Error';
    // Strip query string to avoid leaking sensitive parameters (e.g. OAuth2 codes)
    const rawInstance = request.originalUrl || request.url || '/';
    const instance = rawInstance.includes('?')
      ? rawInstance.slice(0, rawInstance.indexOf('?'))
      : rawInstance;

    const problem: ProblemDetails = {
      title,
      status,
      detail,
      instance,
    };

    response.status(status);
    response.setHeader(
      'content-type',
      'application/problem+json; charset=utf-8',
    );
    response.send(JSON.stringify(problem));
  }
}
