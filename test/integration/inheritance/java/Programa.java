
class Programa {

    public static void main(String args[]) {
        Bloco b = new Bloco();
        Inimigo i = new Inimigo();
        i.mudarPosicaoX(-2);
        b.mudarPosicaoZ(23);
        i.mostrarPosicoes();
        b.mostrarPosicoes();

        System.out.print(Objeto3DNovo.numInstancias);

        Bloco b2 = new Bloco();
        b2.mostrarPosicoes();
        b2.posicao = b.posicao;
        b2.mudarPosicaoY(i.posicao.getX() * 2 / 3);
        b2.mostrarPosicoes();
        b.mostrarPosicoes();
        b.mudarPosicaoZ(5).mudarPosicaoX(-100);
        b.mudarPosicaoY(i.posicao.getY() + i.posicao.getZ() - i.posicao.getX());
        b.mostrarPosicoes();

        b.mostrarIdentificacao();
        i.mostrarIdentificacao();

        b.testeFnc(i);
        i.mostrarPosicoes();

        i.mudarPosicaoX(8).mudarPosicaoZ(2);
        i.mostrarPosicoes();

        b.posicao = i.posicao;
        b2.posicao = b.posicao;

        Vetor3D pos = b.posicao;
        pos.setX(3 * 9);

        b = new Bloco();
        b.mostrarPosicoes();
        b2.mostrarPosicoes();
        if (b.posicao.getX() < 10) {
            i.mostrarPosicoes();
        } else if (b.posicao.getX() > 25) {
            System.out.println("é maior que 25");
        }


        System.out.print("Quantidade de instancias: ");
        System.out.print(Objeto3DNovo.numInstancias);
    }

}
