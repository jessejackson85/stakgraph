import * as path from "path";
import * as yaml from "js-yaml";
import { Neo4jNode, Service, ServiceParser } from "./types.js";

class TsParser implements ServiceParser {
  pkgFileName = "package.json";
  envRegex = /process\.env\.(\w+)/g;

  build(pkgFile: Neo4jNode): Service {
    const body = pkgFile.properties.body;
    const dir = path.dirname(pkgFile.properties.file);

    if (
      !body ||
      body.trim() === "" ||
      body === "undefined" ||
      body === "null"
    ) {
      console.warn(
        `Invalid package.json body for ${pkgFile.properties.file}: ${body}`
      );
      return this.createDefaultService(dir, pkgFile.properties.file);
    }

    try {
      const pkg = JSON.parse(body);
      return {
        name: pkg.name || path.basename(dir),
        language: "javascript",
        dev: true,
        scripts: {
          start: pkg.scripts?.start || "npm start",
          install: "npm install",
          build: pkg.scripts?.build || "npm run build",
          test: pkg.scripts?.test || "npm test",
        },
        env: {},
        pkgFile: pkgFile.properties.file,
      };
    } catch (error) {
      console.error(
        `Failed to parse package.json for ${pkgFile.properties.file}:`,
        error
      );
      return this.createDefaultService(dir, pkgFile.properties.file);
    }
  }

  private createDefaultService(dir: string, filePath: string): Service {
    return {
      name: path.basename(dir),
      language: "javascript",
      dev: true,
      scripts: {
        install: "npm install",
        start: "npm start",
        build: "npm run build",
        test: "npm test",
      },
      env: {},
      pkgFile: filePath,
    };
  }
}

class GoParser implements ServiceParser {
  pkgFileName = "go.mod";
  envRegex = /os\.(?:Getenv|LookupEnv)\("([^"]+)"\)/g;

  build(pkgFile: Neo4jNode): Service {
    const dir = path.dirname(pkgFile.properties.file);
    const serviceName = path.basename(dir);

    return {
      name: serviceName,
      language: "go",
      dev: true,
      scripts: {
        install: "go mod tidy",
        build: `go build -o ${serviceName}`,
        start: `./${serviceName}`,
        test: "go test ./...",
      },
      env: {},
      pkgFile: pkgFile.properties.file,
    };
  }
}
class RustParser implements ServiceParser {
  pkgFileName = "Cargo.toml";
  envRegex = /std::env::var\("([^"]+)"\)/g;

  build(pkgFile: Neo4jNode): Service {
    const dir = path.dirname(pkgFile.properties.file);
    const serviceName = path.basename(dir);

    return {
      name: serviceName,
      language: "rust",
      dev: true,
      scripts: {
        install: "cargo build",
        start: `cargo run`,
        build: "cargo build --release",
        test: "cargo test",
      },
      env: {},
      pkgFile: pkgFile.properties.file,
    };
  }
}

class RubyParser implements ServiceParser {
  pkgFileName = "Gemfile";
  envRegex = /ENV\[['"]([^'"]+)['"]\]/g;

  build(pkgFile: Neo4jNode): Service {
    const dir = path.dirname(pkgFile.properties.file);
    const serviceName = path.basename(dir);

    return {
      name: serviceName,
      language: "ruby",
      dev: true,
      scripts: {
        install: "bundle install",
        start: `bundle exec rails server`,
        build: "echo 'No build step for Ruby/Rails by default'",
        test: "bundle exec rake test",
      },
      env: {},
      pkgFile: pkgFile.properties.file,
    };
  }
}

const serviceParsers: ServiceParser[] = [
  new TsParser(),
  new GoParser(),
  new RustParser(),
  new RubyParser(),
];
function extractEnvVarNames(body: string, regexes: RegExp[]): string[] {
  if (!body) return [];
  let allMatches: string[] = [];
  for (const regex of regexes) {
    const matches = [...body.matchAll(regex)].map((match) => match[1]);
    allMatches = allMatches.concat(matches);
  }
  return allMatches;
}

export function generate_services_config(
  pkgFiles: Neo4jNode[],
  allFiles: Neo4jNode[],
  envVarNodes: Neo4jNode[]
): any[] {
  const serviceMap = new Map<string, any>();

  // parse package files
  for (const file of pkgFiles) {
    console.log("===> file", file.properties.name);
    const parser = serviceParsers.find((p) =>
      file.properties.name.endsWith(p.pkgFileName)
    );
    console.log("===> parser", parser);
    if (parser) {
      const service = parser.build(file);
      if (service.name) {
        console.log("===> service", service.name);
        serviceMap.set(service.name, service);
      } else {
        console.log("===> no service name", file.properties.name);
      }
    }
  }

  console.log("===> serviceMap", serviceMap);

  const PARSE_DOCKER_COMPOSE = false;
  if (PARSE_DOCKER_COMPOSE) {
    // args in docker-compose files
    const dcFiles = allFiles.filter(
      (f) =>
        f.properties.name.endsWith("docker-compose.yml") ||
        f.properties.name.endsWith("docker-compose.yaml")
    );
    for (const dcFile of dcFiles) {
      try {
        const body = dcFile.properties.body;
        if (
          !body ||
          body.trim() === "" ||
          body === "undefined" ||
          body === "null"
        ) {
          console.warn(
            `Invalid docker-compose body for ${dcFile.properties.file}: ${body}`
          );
          continue;
        }
        const dcContent = yaml.load(dcFile.properties.body) as any;
        if (dcContent && dcContent.services) {
          for (const serviceName in dcContent.services) {
            const dcService = dcContent.services[serviceName];
            const service = serviceMap.get(serviceName) || {
              name: serviceName,
              language: "unknown",
              dev: false,
              scripts: {},
              env: {},
              pkgFile: path.dirname(dcFile.properties.file),
            };

            if (dcService.environment) {
              const env = Array.isArray(dcService.environment)
                ? Object.fromEntries(
                    dcService.environment.map((e: string) => e.split("="))
                  )
                : dcService.environment;
              service.env = { ...service.env, ...env };
            }
            serviceMap.set(serviceName, service);
          }
        }
      } catch (error) {
        console.error(
          `Error processing docker-compose file ${dcFile.properties.file}:`,
          error
        );
        continue;
      }
    }
  }

  const PARSE_ENV_VARS = true;
  if (PARSE_ENV_VARS) {
    //env found in code
    const envRegexes = serviceParsers.map((p) => p.envRegex);
    for (const envVarNode of envVarNodes) {
      const nodeFile = envVarNode.properties.file;
      if (!nodeFile) continue;

      const body = envVarNode.properties.body;
      if (!body || body === "undefined" || body === "null") continue;

      const varNames = extractEnvVarNames(body, envRegexes);
      if (varNames.length === 0) continue;

      // Find the single, most specific service this file belongs to
      let bestMatchService: any = null;
      let longestMatchPath = "";

      for (const service of serviceMap.values()) {
        if (service.language !== "unknown" && service.pkgFile) {
          const serviceDir = path.dirname(service.pkgFile);
          if (
            nodeFile.startsWith(serviceDir) &&
            serviceDir.length > longestMatchPath.length
          ) {
            longestMatchPath = serviceDir;
            bestMatchService = service;
          }
        }
      }

      // If we found a specific service, add the env vars ONLY to it
      if (bestMatchService) {
        for (const varName of varNames) {
          if (!bestMatchService.env[varName]) {
            bestMatchService.env[varName] = "";
          }
        }
      }
    }
  }

  const finalServices: any[] = [];
  for (const service of serviceMap.values()) {
    const { pkgFile, ...finalService } = service;
    finalServices.push(finalService);
  }

  return finalServices;
}
