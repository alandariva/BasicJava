
class Programa {

    int num = 10;

    Programa getProg() {
        return this;
    }

    public static void main(String args[]) {
        int x = 0;
        System.out.println(x++);
        System.out.println(++x);
        int y = x++;
        x += y--;
        y *= ++y + 6;
        System.out.println("x: " + x);
        System.out.println("y: " + y);
        if (x > 0) {
            x*=y;
            x-=y;
            x/=y;
            x+=y;
        }
        System.out.println(x);

        Programa p = new Programa();
        p.getProg().num++;
        if (p.getProg().num > 10 && x == 12) {
            System.out.println("SIM");
        }
        if ((p.getProg().num > 10 && x == 11) || (x - 5 == 7)) {
            System.out.println("SIM");
        }

        boolean b = ((p.getProg().num > 10 && x == 11) || (x - 5 == 7));
        if (b && false) {
            System.out.println("Nao executa");
        } else if (3 < 2) {
            System.out.println("Nao executa");
        } else {
            System.out.println("Executou");
        }

        x-=-y;
        System.out.println(x);

        System.out.print(p.getProg().num);
    }

}
