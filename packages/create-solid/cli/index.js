import fs from "fs";
import parser from "gitignore-parser";
import { bold, cyan, gray, green, red } from "kleur/colors";
import path from "path";
import prompts from "prompts/lib/index";
import glob from "tiny-glob/sync.js";
import { viaContentsApi } from "./github.js";
import { version } from "../package.json";
import degit from "degit";
import fetch from "node-fetch";
import { transformSync } from "@babel/core";
import presetTypescript from "@babel/preset-typescript";
import pluginSyntaxJSX from "@babel/plugin-syntax-jsx";
import prettier from "prettier/esm/standalone.mjs";
import prettierBabel from "prettier/esm/parser-babel.mjs";
import prettierHTML from "prettier/esm/parser-html.mjs";
import yargsParser from "yargs-parser";

const gitIgnore = `
dist
.solid
.output
.vercel
.netlify
netlify

# dependencies
/node_modules

# IDEs and editors
/.idea
.project
.classpath
*.launch
.settings/

# Temp
gitignore

# System Files
.DS_Store
Thumbs.db
`;

const disclaimer = `
Welcome to the SolidStart setup wizard!

There are definitely bugs and some feature might not work yet.
If you encounter an issue, have a look at https://github.com/solidjs/solid-start/issues and open a new one, if it is not already tracked.
`;

function mkdirp(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    if (e.code === "EEXIST") return;
    throw e;
  }
}

async function main() {
  console.log(gray(`\ncreate-solid version ${version}`));
  console.log(red(disclaimer));

  let args = yargsParser(process.argv.slice(2));

  const target = process.argv[2] || ".";

  let config = {
    directory: args.example_dir ? args.example_dir : "examples",
    repository: args.repo ? args.repo.split("/")[1] : "solid-start",
    user: args.repo ? args.repo.split("/")[0] : "solidjs",
    ref: args.branch ? args.branch : "main"
  };

  let templates = {};
  const templateDirs = (await viaContentsApi(config)).filter(
    d => d !== config.directory + "/" + ".DS_Store"
  );

  // const packageJsons = templateDirs.map(dir => {
  //   let url = `https://raw.githubusercontent.com/${config.user}/${config.repository}/${config.ref}/${dir}/package.json`;
  //   console.log(url);
  //   return fetch(url).then(s => s.json());
  // });

  // const packageJsonsMap = await Promise.all(packageJsons);

  templateDirs.forEach(dir => {
    let template = dir.replace("examples/", "");
    if (!templates[template]) {
      templates[template] = {
        name: template,
        client: true,
        ssr: true,
        js: true,
        ts: true
      };
    }
  });

  let templateNames = [...Object.values(templates)];

  const templateName = (
    await prompts({
      type: "select",
      name: "template",
      message: "Which template do you want to use?",
      choices: templateNames.map(template => ({ title: template.name, value: template.name })),
      initial: 0
    })
  ).template;

  if (!templateName) {
    throw new Error("No template selected");
  }

  let ssr = (
    await prompts({
      type: "confirm",
      name: "value",
      message: "Server Side Rendering?",
      initial: true
    })
  ).value;

  let ts_response = (
    await prompts({
      type: "confirm",
      name: "value",
      message: "Use TypeScript?",
      initial: false
    })
  ).value;

  if (fs.existsSync(target)) {
    if (fs.readdirSync(target).length > 0) {
      const response = await prompts({
        type: "confirm",
        name: "value",
        message: "Directory not empty. Continue?",
        initial: false
      });

      if (!response.value) {
        process.exit(1);
      }
    }
  } else {
    mkdirp(target);
  }

  let tempTemplate = path.join(target, ".solid-start");

  await new Promise((res, rej) => {
    const emitter = degit(
      `${config.user}/${config.repository}/${config.directory}/${templateName}#${config.ref}`,
      {
        cache: false,
        force: true,
        verbose: true
      }
    );

    emitter.on("info", info => {
      console.log(info.message);
    });

    emitter.clone(path.join(process.cwd(), tempTemplate)).then(() => {
      res({});
    });
  });

  const templateDir = path.join(process.cwd(), tempTemplate);
  const gitignore_contents = gitIgnore;
  const gitignore = parser.compile(gitignore_contents);

  const files = glob("**/*", { cwd: templateDir }).filter(gitignore.accepts);

  let indexHTML = undefined;
  files.forEach(file => {
    const src = path.join(templateDir, file);
    const dest = path.join(target, file);

    if (fs.statSync(src).isDirectory()) {
      mkdirp(dest);
    } else {
      if (src.endsWith("entry-server.tsx") && !ssr) {
        return;
      }

      if (src.endsWith("tsconfig.json") && !ts_response) {
        return fs.writeFileSync(
          path.join(target, "jsconfig.json"),
          JSON.stringify(
            {
              compilerOptions: {
                jsx: "preserve",
                jsxImportSource: "solid-js",
                paths: {
                  "~/*": ["./src/*"]
                }
              }
            },
            null,
            2
          )
        );
      }

      let code = fs.readFileSync(src).toString();

      if (src.endsWith("entry-client.tsx") && !ssr) {
        code = `
        import { render } from "solid-js/web";
        import { StartClient } from "solid-start/entry-client";

        render(() => <StartClient />, document.body);
        `;
      }

      if (src.endsWith("root.tsx") && !ssr) {
        /**
         * src/root.tsx
         *
         *   export default function Root() {
         *      return (
         *        <html lang="fr">
         *          <head>
         *            <title>Solid Start</title>
         *            <meta name="viewport" content="width=device-width, initial-scale=1" />
         *            <Meta />
         *            </Links />
         *          </head>
         *          <body class="body-class">
         *            <Routes/>
         *            <Scripts />
         *          </body>
         *        </html>
         *      );
         *    }
         *           ↓ ↓ ↓ ↓ ↓ ↓ ↓ ↓
         *
         * src/root.tsx
         *
         *   export default function Root() {
         *    return (
         *      <>
         *        <Routes/>
         *        <Scripts />
         *      </>
         *    );
         *   }
         *
         * index.html
         *
         *    <!DOCTYPE html>
         *    <html lang="fr">
         *     <head>
         *       <title>Solid Start</title>
         *       <meta name="viewport" content="width=device-width, initial-scale=1" />
         *       <script type="module" src="./src/entry-client.tsx"></script>
         *     </head>
         *     <body class="body-class">
         *     </body>
         *    </html>
         */
        let root = code;
        let bodyLeft = root.search("<body") + 5;
        let bodyRight = root.search("</body>");

        let headLeft = root.search("<head") + 5;
        let headRight = root.search("</head>");

        let htmlLeft = root.search("<html");
        let htmlLeftEnd = htmlLeft + 5;
        let htmlRight = root.search("</html>") + 8;

        let head = root.substring(headLeft + root.substring(headLeft).search(">") + 1, headRight);
        let body = root.substring(bodyLeft + root.substring(bodyLeft).search(">") + 1, bodyRight);
        let bodyProps = root.substring(bodyLeft, bodyLeft + root.substring(bodyLeft).search(">"));
        let htmlProps = root.substring(
          htmlLeftEnd,
          htmlLeftEnd + root.substring(htmlLeftEnd).search(">")
        );
        let rootTxt =
          root
            .substring(0, htmlLeft)
            .replace("import { Links, Meta, Routes, Scripts }", `import { Routes }`) +
          `<>` +
          body +
          `</>` +
          root.substring(htmlRight);
        code = rootTxt.replace(`<Scripts />`, "");

        let headTxt = head.replace(`<Meta />`, "").replace(`<Links />`, "");

        indexHTML = prettier.format(
          `<!DOCTYPE html>
        <html ${htmlProps}>
          <head>
            ${headTxt}
            <script type="module" src="./src/entry-client.${ts_response ? "tsx" : "jsx"}"></script>
          </head>
          <body ${bodyProps}></body>
        </html>`,
          {
            parser: "html",
            plugins: [prettierHTML]
          }
        );
      }

      if (src.includes("vite.config") && !ssr) {
        code = code
          .replace(`solid({`, `solid({ ssr: false, `)
          .replace(`solid()`, `solid({ ssr: false })`);
      }

      if (src.endsWith(".ts") || src.endsWith(".tsx")) {
        if (!ts_response) {
          let compiledCode = transformSync(code, {
            // transforms: ["typescript", "jsx"],
            // disableESTransforms: true
            filename: dest,
            presets: [presetTypescript],
            plugins: [pluginSyntaxJSX]
          }).code;

          compiledCode = prettier.format(compiledCode, {
            parser: "babel",
            plugins: [prettierBabel]
          });

          fs.writeFileSync(dest.replace(".ts", ".js"), compiledCode);
        } else {
          fs.writeFileSync(
            dest,
            prettier.format(code, { parser: "babel-ts", plugins: [prettierBabel] })
          );
        }
      } else {
        fs.copyFileSync(src, dest);
      }
    }
  });

  fs.writeFileSync(path.join(target, ".gitignore"), gitignore_contents);

  const name = path.basename(path.resolve(target));

  const pkg_file = path.join(target, "package.json");
  const pkg_json = JSON.parse(
    fs
      .readFileSync(pkg_file, "utf-8")
      .replace(/"name": ".+"/, _m => `"name": "${name}"`)
      .replace(/"(.+)": "workspace:.+"/g, (_m, name) => `"${name}": "next"`)
  ); // TODO ^${versions[name]}

  if (!ts_response) {
    delete pkg_json.devDependencies["typescript"];
  }

  fs.writeFileSync(pkg_file, JSON.stringify(pkg_json, null, 2));

  if (!ssr) {
    fs.writeFileSync(path.join(target, "index.html"), indexHTML);
  }

  fs.rmSync(path.join(process.cwd(), tempTemplate), {
    recursive: true,
    force: true
  });

  console.log(bold(green("✔ Copied project files")));

  console.log("\nNext steps:");
  let i = 1;

  const relative = path.relative(process.cwd(), target);
  if (relative !== "") {
    console.log(`  ${i++}: ${bold(cyan(`cd ${relative}`))}`);
  }

  console.log(`  ${i++}: ${bold(cyan("npm install"))} (or pnpm install, or yarn)`);
  console.log(`  ${i++}: ${bold(cyan("npm run dev -- --open"))}`);

  console.log(`\nTo close the dev server, hit ${bold(cyan("Ctrl-C"))}`);
}

main();
